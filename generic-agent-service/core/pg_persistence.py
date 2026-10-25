"""LangGraph checkpoint/store persistence on the personal CVM PostgreSQL.

This direct LANGGRAPH_PG_* connection is separate from Supabase user data,
which is accessed through Supabase APIs. Connection secrets are environment-only.
"""

import asyncio
import os
import re
from contextlib import asynccontextmanager
from typing import Any

from langgraph.checkpoint.base import WRITES_IDX_MAP
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.store.postgres import AsyncPostgresStore
from psycopg import AsyncConnection, sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

SENSITIVE_KEYS = frozenset({'supabase_token', 'access_token', 'refresh_token', 'authorization',
                            'password', 'api_key', 'openai_api_key'})


def redact_credentials(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: redact_credentials(item) for key, item in value.items()
                if str(key).lower() not in SENSITIVE_KEYS}
    if isinstance(value, list):
        return [redact_credentials(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_credentials(item) for item in value)
    return value


def pg_schema() -> str:
    schema = os.environ.get('LANGGRAPH_PG_SCHEMA', 'language_ai_lab')
    if not re.fullmatch(r'[a-z][a-z0-9_]{0,62}', schema):
        raise ValueError('LANGGRAPH_PG_SCHEMA 必须是普通小写 SQL 标识符')
    return schema


def pg_conninfo() -> str:
    required = ['HOST', 'DATABASE', 'USER', 'PASSWORD']
    if any(not os.environ.get(f'LANGGRAPH_PG_{name}') for name in required):
        raise ValueError('缺少 LANGGRAPH_PG_HOST/DATABASE/USER/PASSWORD 环境配置')
    sslmode = os.environ.get('LANGGRAPH_PG_SSLMODE', 'require')
    if sslmode not in {'require', 'verify-ca', 'verify-full'}:
        raise ValueError('PostgreSQL 远程连接必须使用 TLS，请配置 require 或 verify-full')
    kwargs = dict(host=os.environ['LANGGRAPH_PG_HOST'], port=os.environ.get('LANGGRAPH_PG_PORT', '5432'),
                  dbname=os.environ['LANGGRAPH_PG_DATABASE'], user=os.environ['LANGGRAPH_PG_USER'],
                  password=os.environ['LANGGRAPH_PG_PASSWORD'], sslmode=sslmode,
                  connect_timeout='8', application_name='language-ai-lab',
                  options=f'-c search_path={pg_schema()}')
    if os.environ.get('LANGGRAPH_PG_SSLROOTCERT'):
        kwargs['sslrootcert'] = os.environ['LANGGRAPH_PG_SSLROOTCERT']
    if os.environ.get('LANGGRAPH_PG_HOSTADDR'):
        kwargs['hostaddr'] = os.environ['LANGGRAPH_PG_HOSTADDR']
    return make_conninfo(**kwargs)


class PrivatePostgresSaver(AsyncPostgresSaver):
    async def aput(self, config, checkpoint, metadata, new_versions):
        return await super().aput(redact_credentials(config), checkpoint, redact_credentials(metadata), new_versions)

    async def aput_writes(self, config, writes, task_id, task_path=''):
        run_id = (config.get('run_id') or (config.get('metadata') or {}).get('run_id')
                  or config['configurable'].get('run_id'))
        query = (self.UPSERT_CHECKPOINT_WRITES_SQL if all(channel in WRITES_IDX_MAP for channel, _ in writes)
                 else self.INSERT_CHECKPOINT_WRITES_SQL)
        cfg = config['configurable']
        params = await asyncio.to_thread(self._dump_writes, cfg['thread_id'], cfg['checkpoint_ns'],
                                         cfg['checkpoint_id'], task_id, task_path, writes)
        async with self._cursor() as cursor, cursor.connection.transaction():
            await cursor.executemany(query, params)
            if run_id and writes:
                await cursor.execute('''INSERT INTO checkpoint_write_runs
                    (thread_id, checkpoint_ns, checkpoint_id, task_id, run_id) VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id, task_id) DO UPDATE SET run_id = EXCLUDED.run_id''',
                    (cfg['thread_id'], cfg['checkpoint_ns'], cfg['checkpoint_id'], task_id, str(run_id)))

    async def adelete_thread(self, thread_id):
        async with self._cursor() as cursor, cursor.connection.transaction():
            for table in ['checkpoint_write_runs', 'checkpoint_writes', 'checkpoint_blobs', 'checkpoints']:
                await cursor.execute(sql.SQL('DELETE FROM {} WHERE thread_id = %s').format(sql.Identifier(table)), (str(thread_id),))

    async def adelete_for_runs(self, run_ids):
        ids = list(run_ids)
        if not ids:
            return
        async with self._cursor() as cursor, cursor.connection.transaction():
            await cursor.execute('''DELETE FROM checkpoint_writes w USING checkpoint_write_runs r
                WHERE w.thread_id = r.thread_id AND w.checkpoint_ns = r.checkpoint_ns
                AND w.checkpoint_id = r.checkpoint_id AND w.task_id = r.task_id AND r.run_id = ANY(%s)''', (ids,))
            await cursor.execute('DELETE FROM checkpoint_write_runs WHERE run_id = ANY(%s)', (ids,))
            await cursor.execute('''DELETE FROM checkpoint_writes w USING checkpoints c
                WHERE w.thread_id = c.thread_id AND w.checkpoint_ns = c.checkpoint_ns
                AND w.checkpoint_id = c.checkpoint_id AND c.metadata->>'run_id' = ANY(%s)''', (ids,))
            await cursor.execute("DELETE FROM checkpoints WHERE metadata->>'run_id' = ANY(%s)", (ids,))

    async def aprune(self, thread_ids, *, strategy='keep_latest'):
        await super().aprune(thread_ids, strategy='delete' if strategy == 'delete_all' else strategy)


@asynccontextmanager
async def create_checkpointer():
    pool = AsyncConnectionPool(pg_conninfo(), min_size=1, max_size=4, open=False, timeout=10,
                               kwargs={'autocommit': True, 'prepare_threshold': 0, 'row_factory': dict_row})
    try:
        await pool.open(wait=True)
        yield PrivatePostgresSaver(pool, serde=JsonPlusSerializer(pickle_fallback=False))
    finally:
        await pool.close()


@asynccontextmanager
async def create_store():
    async with AsyncPostgresStore.from_conn_string(pg_conninfo(), pool_config={'min_size': 1, 'max_size': 4}) as store:
        yield store


async def setup_database():
    async with await AsyncConnection.connect(pg_conninfo(), autocommit=True) as conn:
        await conn.execute(sql.SQL('CREATE SCHEMA IF NOT EXISTS {}').format(sql.Identifier(pg_schema())))
        await conn.execute('SELECT pg_advisory_lock(%s)', (713624899,))
        try:
            await PrivatePostgresSaver(conn).setup()
            await AsyncPostgresStore(conn).setup()
            await conn.execute('''CREATE TABLE IF NOT EXISTS checkpoint_write_runs (
                thread_id TEXT NOT NULL, checkpoint_ns TEXT NOT NULL, checkpoint_id TEXT NOT NULL,
                task_id TEXT NOT NULL, run_id TEXT NOT NULL,
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id))''')
            await conn.execute('CREATE INDEX IF NOT EXISTS checkpoint_write_runs_run_idx ON checkpoint_write_runs(run_id)')
        finally:
            await conn.execute('SELECT pg_advisory_unlock(%s)', (713624899,))


if __name__ == '__main__':
    from dotenv import load_dotenv

    load_dotenv()
    try:
        asyncio.run(setup_database())
    except Exception as exc:
        print(f'PostgreSQL 初始化失败（{type(exc).__name__}），请检查连接、TLS 和数据库权限。')
        raise SystemExit(1) from None
    print(f'PostgreSQL checkpoint/store 表已初始化，schema={pg_schema()}。')
