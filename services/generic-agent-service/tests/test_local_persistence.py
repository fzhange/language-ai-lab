import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import uuid
from contextlib import contextmanager
from pathlib import Path


class LocalPersistenceTests(unittest.TestCase):
    def test_thread_checkpoint_and_store_survive_server_restart_without_postgresql(self):
        root = Path(__file__).resolve().parents[1]
        config = json.loads((root / 'langgraph.json').read_text())
        config['dependencies'] = [str(root)]
        for key, value in config['graphs'].items():
            file, symbol = value.split(':')
            config['graphs'][key] = str(root / file) + ':' + symbol
        for section in ['http', 'checkpointer', 'store']:
            if section in config and 'path' in config[section]:
                file, symbol = config[section]['path'].split(':')
                config[section]['path'] = str(root / file) + ':' + symbol
        file, symbol = config['http']['app'].split(':')
        config['http']['app'] = str(root / file) + ':' + symbol
        config['env'] = {
            'OPENAI_API_KEY': 'test-local-model-secret',
            'OPENAI_BASE_URL': 'http://127.0.0.1:1/v1',
            'LANGSMITH_TRACING': 'false',
            'LANGCHAIN_TRACING_V2': 'false',
        }
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(('LANGGRAPH_', 'LANGSMITH_', 'LANGCHAIN_',
                                      'OPENAI_', 'SUPABASE_', 'LANGGRAPH_PG_'))}
        env.update(PYTHONPATH=str(root), LANGSMITH_TRACING='false',
                   LANGCHAIN_TRACING_V2='false', LANGGRAPH_METRICS_ENABLED='false',
                   LANGGRAPH_LOGS_ENABLED='false')
        thread_id = str(uuid.uuid4())
        namespace = ['local-persistence-test']
        with tempfile.TemporaryDirectory(prefix='.local-server-test-', dir=root) as temporary:
            directory = Path(temporary)
            path = directory / 'langgraph.json'
            path.write_text(json.dumps(config))
            with socket.socket() as socket_:
                socket_.bind(('127.0.0.1', 0))
                port = socket_.getsockname()[1]
            base = f'http://127.0.0.1:{port}'
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

            def request(method, route, data=None):
                body = json.dumps(data).encode() if data is not None else None
                req = urllib.request.Request(base + route, body,
                                             {'Content-Type': 'application/json'}, method=method)
                with opener.open(req, timeout=10) as response:
                    return json.loads(response.read()) if response.status != 204 else None

            @contextmanager
            def server():
                with (directory / 'server.log').open('w+') as log:
                    process = subprocess.Popen(
                        [sys.executable, str(root / '.venv/bin/langgraph'), 'dev',
                         '--config', str(path), '--host', '127.0.0.1', '--port', str(port),
                         '--no-browser', '--no-reload'],
                        cwd=directory, env=env, stdout=log, stderr=subprocess.STDOUT,
                    )
                    try:
                        for _ in range(60):
                            if process.poll() is not None:
                                log.seek(0)
                                self.fail('Isolated dev server failed to start:\n' + log.read())
                            try:
                                request('GET', '/ok')
                                break
                            except (OSError, urllib.error.URLError):
                                time.sleep(0.25)
                        else:
                            self.fail('Isolated dev server startup timed out')
                        yield
                    finally:
                        process.terminate()
                        try:
                            process.wait(timeout=15)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.wait()
                            self.fail('Dev server did not shut down gracefully')

            with server():
                request('PUT', '/store/items', {
                    'namespace': namespace, 'key': 'prefs', 'value': {'language': 'Chinese'},
                })
                request('POST', '/threads', {
                    'thread_id': thread_id, 'metadata': {'graph_id': 'highlight-buddy'},
                })
                request('POST', f'/threads/{thread_id}/state', {
                    'values': {'messages': [{'type': 'human', 'content': 'Local test state'}]},
                    'as_node': '__start__',
                })
                state = request('GET', f'/threads/{thread_id}/state')
                self.assertEqual(state['values']['messages'][0]['content'], 'Local test state')

            snapshots = list((directory / '.langgraph_api').glob('*.pckl'))
            self.assertTrue(snapshots, 'Dev server must persist data locally')
            for snapshot in snapshots:
                self.assertNotIn(b'test-local-model-secret', snapshot.read_bytes())

            with server():
                self.assertEqual(request('GET', f'/threads/{thread_id}')['thread_id'], thread_id)
                state = request('GET', f'/threads/{thread_id}/state')
                self.assertEqual(state['values']['messages'][0]['content'], 'Local test state')
                query = urllib.parse.urlencode({'namespace': '.'.join(namespace), 'key': 'prefs'})
                item = request('GET', '/store/items?' + query)
                self.assertEqual(item['value'], {'language': 'Chinese'})
                request('DELETE', f'/threads/{thread_id}')
                request('DELETE', '/store/items', {'namespace': namespace, 'key': 'prefs'})


if __name__ == '__main__':
    unittest.main()
