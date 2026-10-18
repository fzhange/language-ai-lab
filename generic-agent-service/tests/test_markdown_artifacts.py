import asyncio
import hashlib
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from threading import Lock
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command


class ToolCallingModel(FakeMessagesListChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.lock = Lock()
        self.failure = None

    def put_object(self, **kwargs):
        if self.failure:
            raise self.failure
        key = (kwargs['Bucket'], kwargs['Key'])
        with self.lock:
            if key in self.objects and kwargs.get('IfNoneMatch') == '*':
                raise ClientError({'Error': {'Code': 'PreconditionFailed', 'Message': 'exists'}}, 'PutObject')
            self.objects[key] = kwargs

    def get_object(self, *, Bucket, Key):
        if self.failure:
            raise self.failure
        with self.lock:
            obj = self.objects.get((Bucket, Key))
        if obj is None:
            raise ClientError({'Error': {'Code': 'NoSuchKey', 'Message': 'missing'}}, 'GetObject')
        return {'Metadata': obj['Metadata'], 'Body': BytesIO(obj['Body'])}


class MarkdownArtifactTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'artifacts'
        self.storage = FakeS3()
        self.env = patch.dict(os.environ, {'SEAWEEDFS_S3_BUCKET': 'documents'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.s3_patcher = patch('core.markdown_artifacts._s3_client', return_value=self.storage)
        self.s3_patcher.start()
        self.addCleanup(self.s3_patcher.stop)

    def save(self, **changes):
        from core.markdown_artifacts import save_markdown
        args = dict(owner='alice', thread_id='thread-a', tool_call_id='call-1', filename='lesson.md', content='# Lesson\nExample.')
        args.update(changes)
        return save_markdown(**args)

    def test_saves_markdown_in_object_storage_not_local_disk(self):
        from core.markdown_artifacts import load_markdown
        result = self.save()
        self.assertEqual(load_markdown(result['artifact_id'], 'alice'), ('lesson.md', '# Lesson\nExample.'))
        self.assertEqual(len(self.storage.objects), 1)
        obj = next(iter(self.storage.objects.values()))
        self.assertEqual(obj['Bucket'], 'documents')
        self.assertEqual(obj['Body'], b'# Lesson\nExample.')
        self.assertEqual(obj['ContentType'], 'text/markdown; charset=utf-8')
        self.assertFalse(self.root.exists())

    def test_client_uses_s3v4_path_style_and_supplied_certificate(self):
        self.s3_patcher.stop()
        from core.markdown_artifacts import _s3_client
        cert = Path(self.tmp.name) / 'server.crt'
        cert.write_text('test certificate path')
        env = {
            'SEAWEEDFS_S3_ENDPOINT_URL': 'https://fordpzhang-any2.devcloud.woa.com:8333',
            'SEAWEEDFS_S3_ACCESS_KEY_ID': 'test-key',
            'SEAWEEDFS_S3_SECRET_ACCESS_KEY': 'test-secret',
            'SEAWEEDFS_S3_CA_BUNDLE': str(cert),
        }
        with patch.dict(os.environ, env), patch('core.markdown_artifacts.boto3.client') as create_client:
            client = _s3_client()
        self.assertIs(client, create_client.return_value)
        options = create_client.call_args.kwargs
        self.assertEqual(options['endpoint_url'], env['SEAWEEDFS_S3_ENDPOINT_URL'])
        self.assertEqual(options['verify'], str(cert))
        self.assertEqual(options['region_name'], 'us-east-1')
        self.assertEqual(options['config'].signature_version, 's3v4')
        self.assertEqual(options['config'].s3['addressing_style'], 'path')

    def test_file_survives_reopening_and_same_call_does_not_duplicate(self):
        from core.markdown_artifacts import load_markdown
        descriptor = self.save()
        self.assertEqual(descriptor, self.save())
        filename, content = load_markdown(descriptor['artifact_id'], 'alice')
        self.assertEqual(filename, 'lesson.md')
        self.assertEqual(content, '# Lesson\nExample.')
        self.assertEqual(len(self.storage.objects), 1)
        with self.assertRaises(ValueError):
            self.save(content='changed')
        with self.assertRaises(FileNotFoundError):
            load_markdown(descriptor['artifact_id'], 'bob')

    def test_concurrent_retries_publish_only_one_file(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.save(), range(8)))
        self.assertTrue(all(result == results[0] for result in results))
        self.assertEqual(len(self.storage.objects), 1)

    def test_invalid_names_and_oversize_content_never_create_artifacts(self):
        for name in ['../secret.md', '/tmp/lesson.md', '.env.md', 'lesson.txt', 'x\\lesson.md', 'x\n.md']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.save(filename=name)
        for content in ['', '  ', 'a' * 200001]:
            with self.assertRaises(ValueError):
                self.save(content=content)
        self.assertEqual(len(self.storage.objects), 0)

    def test_object_content_tampering_is_rejected(self):
        from core.markdown_artifacts import load_markdown
        descriptor = self.save()
        obj = next(iter(self.storage.objects.values()))
        obj['Body'] = b'not the approved content'
        with self.assertRaises(ValueError):
            load_markdown(descriptor['artifact_id'], 'alice')

    def test_storage_failure_does_not_return_an_artifact(self):
        from botocore.exceptions import EndpointConnectionError
        self.storage.failure = EndpointConnectionError(endpoint_url='https://unavailable.example.com:8333')
        with self.assertRaises(EndpointConnectionError):
            self.save()
        self.assertEqual(self.storage.objects, {})

    def test_tool_reports_object_store_failures_instead_of_claiming_success(self):
        from botocore.exceptions import EndpointConnectionError
        from assistants.language_mentor.tools.markdown import create_markdown
        runtime = SimpleNamespace(config={'configurable': {'thread_id': 'thread-a'}}, tool_call_id='call-1')
        self.storage.failure = EndpointConnectionError(endpoint_url='https://unavailable.example.com:8333')
        with patch('assistants.language_mentor.tools.markdown.artifact_owner', new_callable=AsyncMock, return_value='alice'):
            result = asyncio.run(create_markdown.coroutine('lesson.md', '# Lesson', runtime))
        self.assertIn('error', result)
        self.assertNotIn('artifact_id', result)

    def test_download_returns_service_unavailable_on_object_store_error(self):
        from botocore.exceptions import EndpointConnectionError
        from notes_http import app
        descriptor = self.save()
        self.storage.failure = EndpointConnectionError(endpoint_url='https://unavailable.example.com:8333')
        with TestClient(app) as client, patch('markdown_http.artifact_owner', new_callable=AsyncMock, return_value='alice'):
            response = client.get(descriptor['download_path'])
        self.assertEqual(response.status_code, 503)

    def test_tool_hides_runtime_and_uses_verified_owner(self):
        from assistants.language_mentor.tools.markdown import create_markdown
        self.assertEqual(set(create_markdown.tool_call_schema.model_fields), {'filename', 'content'})
        runtime = SimpleNamespace(config={'configurable': {'user_id': 'forged', 'supabase_token': 'token', 'thread_id': 't'}}, tool_call_id='c')
        with patch('assistants.language_mentor.tools.markdown.artifact_owner', new_callable=AsyncMock, return_value='alice'):
            result = asyncio.run(create_markdown.coroutine('lesson.md', '# Lesson', runtime))
        self.assertEqual(result['type'], 'markdown_artifact')
        obj = next(iter(self.storage.objects.values()))
        self.assertEqual(obj['Metadata']['owner'], hashlib.sha256(b'alice').hexdigest())
        self.assertEqual(len(self.storage.objects), 1)

    def test_missing_tool_names_are_repaired_with_runtime_injected_tools_registered(self):
        from assistants.language_mentor.tools import LOCAL_TOOLS
        from core.middleware import RepairToolCallsMiddleware

        middleware = RepairToolCallsMiddleware(LOCAL_TOOLS, prefer=['search_notes', 'read_note', 'list_notes'])
        for args, expected in [({'query': '后置定语'}, 'search_notes'),
                               ({'filename': 'lesson.md', 'content': '# Lesson'}, 'create_markdown'),
                               ({}, 'list_notes')]:
            with self.subTest(expected=expected):
                message = AIMessage(content='', id='msg', tool_calls=[
                    {'name': '', 'args': args, 'id': 'call', 'type': 'tool_call'},
                    {'name': 'list_notes', 'args': {}, 'id': 'list', 'type': 'tool_call'},
                ])
                update = middleware.after_model({'messages': [message]}, None)
                self.assertEqual(update['messages'][0].tool_calls[0]['name'], expected)
                self.assertEqual(update['messages'][0].tool_calls[1]['name'], 'list_notes')
                self.assertEqual(update['messages'][0].id, 'msg')
                self.assertEqual(update['messages'][0].tool_calls[0]['args'], args)

    def test_approval_is_required_before_file_creation_and_rejection_writes_nothing(self):
        from deepagents import create_deep_agent
        from assistants.language_mentor.tools import LOCAL_TOOLS
        from core.middleware import RepairToolCallsMiddleware
        for decision in ['approve', 'reject']:
            with self.subTest(decision=decision):
                model = ToolCallingModel(responses=[
                    AIMessage(content='', tool_calls=[{'name': '', 'args': {'filename': 'lesson.md', 'content': '# Lesson'}, 'id': decision, 'type': 'tool_call'}]),
                    AIMessage(content='Finished'),
                ])
                graph = create_deep_agent(model=model, tools=LOCAL_TOOLS, checkpointer=InMemorySaver(),
                                          middleware=[RepairToolCallsMiddleware(LOCAL_TOOLS)],
                                          interrupt_on={'create_markdown': {'allowed_decisions': ['approve', 'reject']}})
                config = {'configurable': {'thread_id': decision}}
                with patch('assistants.language_mentor.tools.markdown.artifact_owner', new_callable=AsyncMock, return_value='alice'):
                    paused = asyncio.run(graph.ainvoke({'messages': [{'role': 'user', 'content': 'Create a lesson'}]}, config))
                    self.assertIn('__interrupt__', paused)
                    before = len(self.storage.objects)
                    resumed = asyncio.run(graph.ainvoke(Command(resume={'decisions': [{'type': decision}]}), config))
                self.assertNotIn('__interrupt__', resumed)
                self.assertEqual(len(self.storage.objects), before + (decision == 'approve'))

    def test_only_main_mentor_can_publish_downloadable_documents(self):
        import importlib
        from unittest.mock import MagicMock
        with patch('core.model.get_chat_model', return_value=ToolCallingModel(responses=[AIMessage(content='Finished')])):
            agent_module = importlib.import_module('assistants.language_mentor.agent')
        with patch.object(agent_module, 'create_deep_agent', return_value=MagicMock()) as factory:
            asyncio.run(agent_module.make_language_mentor())
        options = factory.call_args.kwargs
        self.assertIn('create_markdown', [tool.name for tool in options['tools']])
        self.assertEqual(options['interrupt_on']['create_markdown']['allowed_decisions'], ['approve', 'reject'])
        delegated_tools = [tool.name for tool in options.get('subagents', [{}])[0].get('tools', options['tools'])]
        self.assertNotIn('create_markdown', delegated_tools)
        self.assertIn('search_notes', delegated_tools)

    def test_download_checks_owner_and_returns_an_attachment(self):
        from notes_http import app
        descriptor = self.save()
        with TestClient(app) as client, patch('markdown_http.artifact_owner', new_callable=AsyncMock, return_value='alice'):
            response = client.get(descriptor['download_path'])
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.text, '# Lesson\nExample.')
            self.assertIn('attachment;', response.headers['content-disposition'])
            self.assertEqual(response.headers['x-content-type-options'], 'nosniff')
        with TestClient(app) as client, patch('markdown_http.artifact_owner', new_callable=AsyncMock, return_value='bob'):
            self.assertEqual(client.get(descriptor['download_path']).status_code, 404)

    def test_configured_auth_requires_a_verified_token(self):
        from notes_http import app
        with patch.dict(os.environ, {'SUPABASE_URL': 'https://auth.example.com', 'SUPABASE_ANON_KEY': 'anon'}), TestClient(app) as client:
            self.assertEqual(client.get('/artifacts/' + 'a' * 64 + '/download').status_code, 401)


if __name__ == '__main__':
    unittest.main()
