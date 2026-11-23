import json
import os
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

from langgraph.checkpoint.base import empty_checkpoint
from psycopg.conninfo import conninfo_to_dict


class PostgresConfigurationTests(unittest.IsolatedAsyncioTestCase):
    def env(self):
        return patch.dict(os.environ, {
            'LANGGRAPH_PG_HOST': 'db.example.com', 'LANGGRAPH_PG_PORT': '5432',
            'LANGGRAPH_PG_DATABASE': 'app', 'LANGGRAPH_PG_USER': 'postgres',
            'LANGGRAPH_PG_PASSWORD': 'test-password', 'LANGGRAPH_PG_SSLMODE': 'require',
        })

    async def test_connection_settings_are_env_only_and_schema_scoped(self):
        from core.pg_persistence import pg_conninfo
        with self.env():
            parsed = conninfo_to_dict(pg_conninfo())
        self.assertEqual(parsed['host'], 'db.example.com')
        self.assertEqual(parsed['dbname'], 'app')
        self.assertEqual(parsed['sslmode'], 'require')
        self.assertEqual(parsed['options'], '-c search_path=language_ai_lab')
        self.assertEqual(parsed['password'], 'test-password')
        with self.env(), patch.dict(os.environ, {'LANGGRAPH_PG_SCHEMA': 'bad; DROP SCHEMA public'}):
            with self.assertRaises(ValueError):
                pg_conninfo()

    async def test_checkpoint_write_redacts_request_credentials_without_mutating_input(self):
        from core.pg_persistence import PrivatePostgresSaver
        saver = PrivatePostgresSaver(MagicMock())
        config = {'configurable': {'thread_id': 't', 'supabase_token': 'secret-jwt'},
                  'metadata': {'authorization': 'Bearer secret-jwt'}}
        metadata = {'step': 1, 'run_id': 'r', 'supabase_token': 'secret-jwt',
                    'nested': {'password': 'secret-password', 'topic': 'grammar'}}
        with patch('core.pg_persistence.AsyncPostgresSaver.aput', new_callable=AsyncMock, return_value={'configurable': {'thread_id': 't'}}) as write:
            await saver.aput(config, empty_checkpoint(), metadata, {})
        args = write.call_args.args
        self.assertNotIn('secret-jwt', json.dumps([args[0], args[2]]))
        self.assertNotIn('secret-password', json.dumps([args[0], args[2]]))
        self.assertEqual(args[2]['nested']['topic'], 'grammar')
        self.assertEqual(config['configurable']['supabase_token'], 'secret-jwt')

    async def test_server_factories_manage_pool_lifetime_without_running_migrations(self):
        from core.pg_persistence import create_checkpointer, create_store
        pool = MagicMock()
        pool.open = AsyncMock()
        pool.close = AsyncMock()
        store = MagicMock()
        @asynccontextmanager
        async def store_context(*args, **kwargs):
            yield store
        with self.env(), patch('core.pg_persistence.AsyncConnectionPool', return_value=pool), patch(
            'core.pg_persistence.AsyncPostgresStore.from_conn_string', side_effect=store_context
        ), patch('core.pg_persistence.PrivatePostgresSaver.setup', new_callable=AsyncMock) as setup:
            async with create_checkpointer() as saver:
                self.assertIs(saver.conn, pool)
                pool.open.assert_awaited_once_with(wait=True)
            pool.close.assert_awaited_once()
            setup.assert_not_awaited()
            async with create_store() as result:
                self.assertIs(result, store)
            store.setup.assert_not_called()


if __name__ == '__main__':
    unittest.main()
