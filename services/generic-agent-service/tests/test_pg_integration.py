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

from langgraph.checkpoint.base import empty_checkpoint

@unittest.skipUnless(os.environ.get('RUN_PG_INTEGRATION') == '1', 'requires explicit PostgreSQL test approval')
class PostgresIntegrationTests(unittest.IsolatedAsyncioTestCase):
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


@unittest.skipUnless(os.environ.get('RUN_PG_INTEGRATION') == '1', 'requires explicit PostgreSQL test approval')
class NativeServerIntegrationTests(unittest.TestCase):
    def test_native_store_and_thread_state_use_postgresql(self):
        import psycopg
        from core.pg_persistence import pg_conninfo
        root = Path(__file__).resolve().parents[1]
        config = json.loads((root / 'langgraph.json').read_text())
        config['checkpointer'] = {
            'backend': 'custom', 'path': './core/pg_persistence.py:create_checkpointer',
        }
        config['store'] = {'path': './core/pg_persistence.py:create_store'}
        config['dependencies'] = [str(root)]
        for key, value in config['graphs'].items():
            file, symbol = value.split(':')
            config['graphs'][key] = str(root / file) + ':' + symbol
        for section in ['checkpointer', 'store']:
            file, symbol = config[section]['path'].split(':')
            config[section]['path'] = str(root / file) + ':' + symbol
        http_file, http_symbol = config['http']['app'].split(':')
        config['http']['app'] = str(root / http_file) + ':' + http_symbol
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
                    request('POST', '/threads', {'thread_id': thread_id, 'metadata': {'graph_id': 'highlight-buddy'}})
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
