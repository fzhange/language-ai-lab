"""Opt-in integration tests: write/delete only uniquely named test records."""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from langchain_core.messages import AIMessage
from langgraph.checkpoint.base import empty_checkpoint
from langgraph.types import Command

from test_markdown_artifacts import ToolCallingModel


@unittest.skipUnless(os.environ.get('RUN_PG_INTEGRATION') == '1', 'requires explicit PostgreSQL test approval')
class PostgresIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_reopened_connections_restore_checkpoints_store_and_memory(self):
        from core.pg_persistence import create_checkpointer, create_store
        from assistants.language_mentor.memory import LearnerMemoryMiddleware, MEMORY_PATH, memory_namespace, save_learning_memory
        from deepagents import create_deep_agent

        owner = 'test-' + uuid.uuid4().hex
        thread_id = owner + '-thread'
        note = '测试偏好：中文讲解'
        import hashlib
        key = hashlib.sha256(note.encode()).hexdigest()
        config = {'configurable': {'thread_id': thread_id, 'supabase_token': 'test-jwt-never-store', 'run_id': owner}}
        try:
            async with create_checkpointer() as saver, create_store() as store:
                graph = create_deep_agent(model=ToolCallingModel(responses=[AIMessage(content='Lesson ready')]),
                                          checkpointer=saver, store=store, middleware=[LearnerMemoryMiddleware()], memory=[MEMORY_PATH])
                runtime = SimpleNamespace(store=store, config=config, tool_call_id='memory-1')
                with patch('assistants.language_mentor.memory.artifact_owner', new_callable=AsyncMock, return_value=owner):
                    await save_learning_memory.coroutine(note, runtime)
                    await graph.ainvoke({'messages': [{'role': 'user', 'content': 'Hello'}]}, config)
            async with create_checkpointer() as saver, create_store() as store:
                checkpoint = await saver.aget_tuple(config)
                self.assertIsNotNone(checkpoint)
                self.assertNotIn('supabase_token', checkpoint.metadata)
                graph = create_deep_agent(model=ToolCallingModel(responses=[AIMessage(content='Next lesson')]),
                                          checkpointer=saver, store=store, middleware=[LearnerMemoryMiddleware()], memory=[MEMORY_PATH])
                with patch('assistants.language_mentor.memory.artifact_owner', new_callable=AsyncMock, return_value=owner):
                    restored = await graph.aget_state(config)
                    self.assertEqual(restored.values['messages'][-1].content, 'Lesson ready')
                    other = await LearnerMemoryMiddleware().abefore_agent({}, SimpleNamespace(store=store), {'configurable': {'thread_id': owner + '-new'}})
                self.assertIn(note, other['memory_contents'][MEMORY_PATH])
                await saver.adelete_for_runs([owner])
                self.assertIsNone(await saver.aget_tuple(config))
                self.assertIsNotNone(await store.aget(memory_namespace(owner), key))
        finally:
            async with create_checkpointer() as saver, create_store() as store:
                await saver.adelete_thread(thread_id)
                await store.adelete(memory_namespace(owner), key)

    async def test_rollback_removes_new_run_writes_on_previous_run_checkpoint(self):
        from core.pg_persistence import create_checkpointer
        tid = 'test-rollback-' + uuid.uuid4().hex
        try:
            async with create_checkpointer() as saver:
                checkpoint = empty_checkpoint()
                config = await saver.aput({'configurable': {'thread_id': tid, 'checkpoint_ns': ''}}, checkpoint, {'run_id': 'previous-' + tid}, {})
                new_config = {**config, 'configurable': {**config['configurable'], 'run_id': 'new-' + tid}}
                await saver.aput_writes(new_config, [('result', 'rollback-me')], 'task-new')
                self.assertTrue((await saver.aget_tuple(config)).pending_writes)
                await saver.adelete_for_runs(['new-' + tid])
                preserved = await saver.aget_tuple(config)
                self.assertIsNotNone(preserved)
                self.assertEqual(preserved.pending_writes, [])
        finally:
            async with create_checkpointer() as saver:
                await saver.adelete_thread(tid)

    async def test_pending_approval_survives_reopening_and_can_be_rejected(self):
        from deepagents import create_deep_agent
        from assistants.language_mentor.tools.markdown import create_markdown
        from core.pg_persistence import create_checkpointer, create_store

        thread_id = 'test-hitl-' + uuid.uuid4().hex
        config = {'configurable': {'thread_id': thread_id, 'run_id': thread_id}}
        def graph(saver, store, *, resuming=False):
            responses = [AIMessage(content='Rejected')] if resuming else [AIMessage(content='', tool_calls=[{
                'name': 'create_markdown', 'args': {'filename': 'test.md', 'content': '# Test'},
                'id': 'test-call', 'type': 'tool_call',
            }]), AIMessage(content='Rejected')]
            return create_deep_agent(
                model=ToolCallingModel(responses=responses), tools=[create_markdown], checkpointer=saver, store=store,
                interrupt_on={'create_markdown': {'allowed_decisions': ['approve', 'reject']}},
            )
        try:
            async with create_checkpointer() as saver, create_store() as store:
                result = await graph(saver, store).ainvoke({'messages': [{'role': 'user', 'content': 'Prepare document'}]}, config)
                self.assertIn('__interrupt__', result)
            async with create_checkpointer() as saver, create_store() as store:
                resumed = graph(saver, store, resuming=True)
                state = await resumed.aget_state(config)
                self.assertTrue(state.tasks[0].interrupts)
                with patch('assistants.language_mentor.tools.markdown.save_markdown') as write:
                    result = await resumed.ainvoke(Command(resume={'decisions': [{'type': 'reject'}]}), config)
                write.assert_not_called()
                self.assertNotIn('__interrupt__', result)
        finally:
            async with create_checkpointer() as saver:
                await saver.adelete_thread(thread_id)


@unittest.skipUnless(os.environ.get('RUN_PG_INTEGRATION') == '1', 'requires explicit PostgreSQL test approval')
class NativeServerIntegrationTests(unittest.TestCase):
    def test_native_store_and_thread_state_use_postgresql(self):
        import psycopg
        from core.pg_persistence import pg_conninfo
        root = Path(__file__).resolve().parents[1]
        config = json.loads((root / 'langgraph.json').read_text())
        config['dependencies'] = [str(root)]
        for key, value in config['graphs'].items():
            file, symbol = value.split(':')
            config['graphs'][key] = str(root / file) + ':' + symbol
        for section in ['checkpointer', 'store']:
            file, symbol = config[section]['path'].split(':')
            config[section]['path'] = str(root / file) + ':' + symbol
        config['http']['app'] = str(root / 'notes_http.py') + ':app'
        config['env'] = str(root / '.env')
        with socket.socket() as socket_:
            socket_.bind(('127.0.0.1', 0))
            port = socket_.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        namespace = 'test-server-' + uuid.uuid4().hex
        thread_id = str(uuid.uuid4())
        def request(method, path, data=None):
            body = json.dumps(data).encode() if data is not None else None
            req = urllib.request.Request(base + path, body, {'Content-Type': 'application/json'}, method=method)
            with urllib.request.urlopen(req, timeout=15) as response:
                return json.loads(response.read()) if response.status != 204 else None
        with tempfile.TemporaryDirectory(prefix='.pg-server-test-', dir=root) as temporary:
            path = Path(temporary) / 'langgraph.json'
            path.write_text(json.dumps(config))
            env = dict(os.environ, PYTHONPATH=str(root), LANGSMITH_TRACING='false', LANGCHAIN_TRACING_V2='false')
            with (Path(temporary) / 'server.log').open('w+') as log:
                process = subprocess.Popen([sys.executable, str(root / '.venv/bin/langgraph'), 'dev', '--config', str(path),
                                            '--port', str(port), '--no-browser', '--no-reload'], cwd=temporary,
                                           env=env, stdout=log, stderr=subprocess.STDOUT)
                try:
                    for _ in range(60):
                        try:
                            request('GET', '/ok')
                            break
                        except OSError:
                            if process.poll() is not None:
                                self.fail('隔离 LangGraph Server 启动失败，请检查配置和服务日志')
                            time.sleep(1)
                    else:
                        self.fail('隔离 LangGraph Server 启动超时')
                    request('PUT', '/store/items', {'namespace': [namespace], 'key': 'prefs', 'value': {'language': 'Chinese'}})
                    request('POST', '/threads', {'thread_id': thread_id, 'metadata': {'graph_id': 'language-mentor'}})
                    request('POST', f'/threads/{thread_id}/state', {'values': {'messages': [{'type': 'human', 'content': 'Test state'}]}, 'as_node': '__start__'})
                    state = request('GET', f'/threads/{thread_id}/state')
                    self.assertEqual(state['values']['messages'][0]['content'], 'Test state')
                    with psycopg.connect(pg_conninfo()) as conn:
                        with conn.cursor() as cursor:
                            cursor.execute('SELECT COUNT(*) FROM checkpoints WHERE thread_id = %s', (thread_id,))
                            self.assertGreater(cursor.fetchone()[0], 0)
                            cursor.execute('SELECT COUNT(*) FROM store WHERE prefix = %s AND key = %s', (namespace, 'prefs'))
                            self.assertEqual(cursor.fetchone()[0], 1)
                    request('DELETE', f'/threads/{thread_id}')
                    request('DELETE', '/store/items', {'namespace': [namespace], 'key': 'prefs'})
                finally:
                    process.terminate()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    with psycopg.connect(pg_conninfo(), autocommit=True) as conn:
                        with conn.cursor() as cursor:
                            for table in ['checkpoint_write_runs', 'checkpoint_writes', 'checkpoint_blobs', 'checkpoints']:
                                cursor.execute(psycopg.sql.SQL('DELETE FROM {} WHERE thread_id = %s').format(psycopg.sql.Identifier(table)), (thread_id,))
                            cursor.execute('DELETE FROM store WHERE prefix = %s', (namespace,))


if __name__ == '__main__':
    unittest.main()
