import asyncio
import json
import os
import unittest
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from langgraph.store.memory import InMemoryStore
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


class LearnerMemoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_verified_user_memory_is_shared_across_threads_not_across_users(self):
        from assistants.language_mentor.memory import LearnerMemoryMiddleware, MEMORY_PATH, save_learning_memory
        store = InMemoryStore()
        runtime = SimpleNamespace(store=store, config={'configurable': {'thread_id': 'a', 'supabase_token': 'alice-token', 'user_id': 'forged'}}, tool_call_id='save-1')
        with patch('assistants.language_mentor.memory.artifact_owner', new_callable=AsyncMock, return_value='alice'):
            await save_learning_memory.coroutine('请用中文解释，英文示范。', runtime)
            await save_learning_memory.coroutine('请用中文解释，英文示范。', runtime)
            memory = LearnerMemoryMiddleware()
            loaded = await memory.abefore_agent({}, SimpleNamespace(store=store), {'configurable': {'thread_id': 'b', 'supabase_token': 'alice-token'}})
        self.assertIn('中文解释', loaded['memory_contents'][MEMORY_PATH])
        self.assertEqual(loaded['memory_contents'][MEMORY_PATH].count('请用中文解释'), 1)
        with patch('assistants.language_mentor.memory.artifact_owner', new_callable=AsyncMock, return_value='bob'):
            other = await memory.abefore_agent(loaded, SimpleNamespace(store=store), {'configurable': {'supabase_token': 'bob-token'}})
        self.assertEqual(other['memory_contents'], {})

    async def test_expired_identity_cannot_read_cached_memory_or_write_memory(self):
        from fastapi import HTTPException
        from assistants.language_mentor.memory import LearnerMemoryMiddleware, save_learning_memory
        runtime = SimpleNamespace(store=InMemoryStore(), config={'configurable': {'supabase_token': 'bad'}}, tool_call_id='c')
        with patch('assistants.language_mentor.memory.artifact_owner', new_callable=AsyncMock, side_effect=HTTPException(401, 'expired')):
            loaded = await LearnerMemoryMiddleware().abefore_agent({'memory_contents': {'old': 'private'}}, runtime, runtime.config)
            saved = await save_learning_memory.coroutine('preference', runtime)
        self.assertEqual(loaded['memory_contents'], {})
        self.assertIn('error', saved)
        self.assertEqual(await runtime.store.alist_namespaces(), [])

    async def test_mentor_registers_memory_source_without_graph_level_persistence(self):
        import importlib
        from langchain_core.messages import AIMessage
        from test_markdown_artifacts import ToolCallingModel
        with patch('core.model.get_chat_model', return_value=ToolCallingModel(responses=[AIMessage(content='OK')])):
            module = importlib.import_module('assistants.language_mentor.agent')
        with patch.object(module, 'create_deep_agent', return_value=MagicMock()) as factory:
            await module.make_language_mentor()
        options = factory.call_args.kwargs
        self.assertEqual(options.get('memory'), ['/memories/AGENTS.md'])
        self.assertIn('save_learning_memory', [tool.name for tool in options['tools']])
        self.assertNotIn('save_learning_memory', [tool.name for tool in options['subagents'][0]['tools']])
        self.assertNotIn('store', options)
        self.assertNotIn('checkpointer', options)

    async def test_parallel_memory_tools_do_not_conflict_in_graph_state(self):
        from deepagents import create_deep_agent
        from langchain_core.messages import AIMessage
        from langgraph.checkpoint.memory import InMemorySaver
        from test_markdown_artifacts import ToolCallingModel
        from assistants.language_mentor.memory import LearnerMemoryMiddleware, MEMORY_PATH, read_memory, save_learning_memory
        store = InMemoryStore()
        model = ToolCallingModel(responses=[AIMessage(content='', tool_calls=[
            {'name': 'save_learning_memory', 'args': {'content': note}, 'id': str(i), 'type': 'tool_call'}
            for i, note in enumerate(['中文讲解', '写作目标 6.5'])
        ]), AIMessage(content='Saved')])
        graph = create_deep_agent(model=model, tools=[save_learning_memory], store=store,
                                  checkpointer=InMemorySaver(), middleware=[LearnerMemoryMiddleware()], memory=[MEMORY_PATH])
        with patch('assistants.language_mentor.memory.artifact_owner', new_callable=AsyncMock, return_value='alice'):
            result = await graph.ainvoke({'messages': [{'role': 'user', 'content': 'Remember both preferences'}]}, {'configurable': {'thread_id': 'parallel'}})
        self.assertEqual(result['messages'][-1].content, 'Saved')
        saved = await read_memory(store, 'alice')
        self.assertIn('中文讲解', saved)
        self.assertIn('写作目标 6.5', saved)

    async def test_memory_tool_schema_and_payload_limits(self):
        from assistants.language_mentor.memory import save_learning_memory
        self.assertEqual(set(save_learning_memory.tool_call_schema.model_fields), {'content'})
        runtime = SimpleNamespace(store=InMemoryStore(), config={'configurable': {}}, tool_call_id='c')
        with patch('assistants.language_mentor.memory.artifact_owner', new_callable=AsyncMock, return_value='alice'):
            for text in ['', 'a' * 2001]:
                result = await save_learning_memory.coroutine(text, runtime)
                self.assertIn('error', result)
        self.assertEqual(await runtime.store.alist_namespaces(), [])


if __name__ == '__main__':
    unittest.main()
