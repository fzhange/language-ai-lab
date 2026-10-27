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
from psycopg.types.json import Jsonb

from core.message_deletion import _REMOVED, as_message_dicts, find_reply, scrub_messages

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
        thread_id = str(config['configurable']['thread_id'])
        async with self._cursor() as cursor, cursor.connection.transaction():
            deleted = await self._deleted_messages(cursor, thread_id)
            cleaned = scrub_messages(checkpoint, deleted)
            # Use the same connection so the identity guard and write commit together.
            saver = AsyncPostgresSaver(cursor.connection, serde=self.serde)
            return await saver.aput(redact_credentials(config), cleaned, redact_credentials(metadata), new_versions)

    async def _deleted_messages(self, cursor, thread_id):
        await cursor.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', (thread_id,))
        await cursor.execute('SELECT message_id FROM deleted_chat_messages WHERE thread_id = %s', (thread_id,))
        return {row['message_id'] for row in await cursor.fetchall()}

    async def aput_writes(self, config, writes, task_id, task_path=''):
        run_id = (config.get('run_id') or (config.get('metadata') or {}).get('run_id')
                  or config['configurable'].get('run_id'))
        query = (self.UPSERT_CHECKPOINT_WRITES_SQL if all(channel in WRITES_IDX_MAP for channel, _ in writes)
                 else self.INSERT_CHECKPOINT_WRITES_SQL)
        cfg = config['configurable']
        async with self._cursor() as cursor, cursor.connection.transaction():
            deleted = await self._deleted_messages(cursor, str(cfg['thread_id']))
            cleaned = [(channel, scrub_messages(value, deleted)) for channel, value in writes]
            cleaned = [(channel, value) for channel, value in cleaned if value is not _REMOVED]
            params = await asyncio.to_thread(self._dump_writes, cfg['thread_id'], cfg['checkpoint_ns'],
                                             cfg['checkpoint_id'], task_id, task_path, cleaned)
            await cursor.executemany(query, params)
            if run_id and writes:
                await cursor.execute('''INSERT INTO checkpoint_write_runs
                    (thread_id, checkpoint_ns, checkpoint_id, task_id, run_id) VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (thread_id, checkpoint_ns, checkpoint_id, task_id) DO UPDATE SET run_id = EXCLUDED.run_id''',
                    (cfg['thread_id'], cfg['checkpoint_ns'], cfg['checkpoint_id'], task_id, str(run_id)))

    async def delete_reply(self, thread_id, message_id, owner, expected_checkpoint):
        """Atomically scrub all saved copies and prevent stale writes restoring a reply."""
        from fastapi import HTTPException

        async with self._cursor() as cursor, cursor.connection.transaction():
            await self._deleted_messages(cursor, thread_id)
            await cursor.execute("SELECT checkpoint_id, metadata FROM checkpoints WHERE thread_id = %s AND checkpoint_ns = '' ORDER BY checkpoint_id DESC LIMIT 1", (thread_id,))
            latest = await cursor.fetchone()
            if not latest or (owner != 'local' and latest['metadata'].get('user_id') != owner):
                raise HTTPException(404, '对话不存在或不可访问')
            if latest['checkpoint_id'] != expected_checkpoint:
                raise HTTPException(409, '对话已更新，请刷新后重试')
            await cursor.execute("SELECT type, blob FROM checkpoint_blobs WHERE thread_id = %s AND checkpoint_ns = '' AND channel = 'messages' UNION ALL SELECT type, blob FROM checkpoint_writes WHERE thread_id = %s AND checkpoint_ns = '' AND channel = 'messages'", (thread_id, thread_id))
            target = None
            for row in await cursor.fetchall():
                if row['blob'] is not None and row['type'] != 'empty':
                    target = find_reply(self.serde.loads_typed((row['type'], bytes(row['blob']))), message_id)
                    if target is not None:
                        break
            if target is None:
                raise HTTPException(400, '只能删除不含工具调用的导师回复')
            await self._scrub_messages(cursor, thread_id, {message_id})

    async def delete_turn(self, thread_id, human_id, owner, expected_checkpoint):
        """Remove one whole question/answer turn (including its tool cards) atomically."""
        from fastapi import HTTPException

        from assistants.language_mentor.turns import keep_other_turns

        async with self._cursor() as cursor, cursor.connection.transaction():
            await self._deleted_messages(cursor, thread_id)
            await cursor.execute("SELECT checkpoint_id, metadata FROM checkpoints WHERE thread_id = %s AND checkpoint_ns = '' ORDER BY checkpoint_id DESC LIMIT 1", (thread_id,))
            latest = await cursor.fetchone()
            if not latest or (owner != 'local' and latest['metadata'].get('user_id') != owner):
                raise HTTPException(404, '对话不存在或不可访问')
            if latest['checkpoint_id'] != expected_checkpoint:
                raise HTTPException(409, '对话已更新，请刷新后重试')
            # Messages are saved either as full snapshots or as one small write per step, so rebuild the
            # whole conversation (snapshots first, then writes in checkpoint order) before validating it.
            await cursor.execute("SELECT type, blob FROM checkpoint_blobs WHERE thread_id = %s AND checkpoint_ns = '' AND channel = 'messages' ORDER BY version", (thread_id,))
            saved = list(await cursor.fetchall())
            await cursor.execute("SELECT type, blob FROM checkpoint_writes WHERE thread_id = %s AND checkpoint_ns = '' AND channel = 'messages' ORDER BY checkpoint_id, task_id, idx", (thread_id,))
            saved += list(await cursor.fetchall())
            history: dict[str, dict] = {}
            for row in saved:
                if row['blob'] is None or row['type'] == 'empty':
                    continue
                for message in as_message_dicts(self.serde.loads_typed((row['type'], bytes(row['blob'])))):
                    if isinstance(message.get('id'), str) and message['id']:
                        history[message['id']] = message  # a re-saved id keeps its original position
            current = list(history.values())
            if human_id not in history:
                raise HTTPException(404, '找不到待删除的提问')
            try:
                retained = keep_other_turns(current, human_id)
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from None
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from None
            kept_ids = {message['id'] for message in retained}
            removed = {message['id'] for message in current if message['id'] not in kept_ids}
            await self._scrub_messages(cursor, thread_id, removed)

    async def _scrub_messages(self, cursor, thread_id, ids):
        """Scrub every saved copy of the given message ids inside the caller's transaction."""
        if not ids:
            return
        await cursor.execute('INSERT INTO deleted_chat_messages (thread_id, message_id) SELECT %s, unnest(%s::text[]) ON CONFLICT DO NOTHING', (thread_id, list(ids)))
        # Checkpoint blobs and pending writes can both contain historical copies.
        for table, keys in [('checkpoint_blobs', ['checkpoint_ns', 'channel', 'version']),
                            ('checkpoint_writes', ['checkpoint_ns', 'checkpoint_id', 'task_id', 'idx'])]:
            await cursor.execute(sql.SQL('SELECT * FROM {} WHERE thread_id = %s').format(sql.Identifier(table)), (thread_id,))
            for saved in await cursor.fetchall():
                if saved['blob'] is None or saved['type'] == 'empty':
                    continue
                original = self.serde.loads_typed((saved['type'], bytes(saved['blob'])))
                cleaned = scrub_messages(original, ids)
                where = sql.SQL(' AND ').join(sql.SQL('{} = %s').format(sql.Identifier(key)) for key in ['thread_id', *keys])
                values = [thread_id, *(saved[key] for key in keys)]
                if cleaned is _REMOVED:
                    await cursor.execute(sql.SQL('DELETE FROM {} WHERE {}').format(sql.Identifier(table), where), values)
                else:
                    kind, blob = self.serde.dumps_typed(cleaned)
                    await cursor.execute(sql.SQL('UPDATE {} SET type = %s, blob = %s WHERE {}').format(sql.Identifier(table), where), [kind, blob, *values])
        await cursor.execute('SELECT checkpoint_ns, checkpoint_id, checkpoint FROM checkpoints WHERE thread_id = %s', (thread_id,))
        for saved in await cursor.fetchall():
            await cursor.execute('UPDATE checkpoints SET checkpoint = %s WHERE thread_id = %s AND checkpoint_ns = %s AND checkpoint_id = %s',
                                 (Jsonb(scrub_messages(saved['checkpoint'], ids)), thread_id, saved['checkpoint_ns'], saved['checkpoint_id']))

    async def adelete_thread(self, thread_id):
        async with self._cursor() as cursor, cursor.connection.transaction():
            for table in ['deleted_chat_messages', 'checkpoint_write_runs', 'checkpoint_writes', 'checkpoint_blobs', 'checkpoints']:
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
            await conn.execute('''CREATE TABLE IF NOT EXISTS deleted_chat_messages (
                thread_id TEXT NOT NULL, message_id TEXT NOT NULL,
                PRIMARY KEY (thread_id, message_id))''')
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
