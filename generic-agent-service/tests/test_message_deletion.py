import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.serde.types import _DeltaSnapshot

from core.message_deletion import find_reply, scrub_messages


class MessageDeletionTests(unittest.TestCase):
    def test_removes_only_selected_reply_from_nested_snapshots(self):
        question = HumanMessage(content='based on', id='question')
        call = AIMessage(content='', id='call', tool_calls=[{'id': 'tool-call', 'name': 'present_synonyms', 'args': {}}])
        card = ToolMessage(content='card', id='card', tool_call_id='tool-call')
        reply = AIMessage(content='unneeded summary', id='reply')
        snapshot = {'messages': [question, call, card, reply], 'nested': {'history': (reply, question)}}
        cleaned = scrub_messages(snapshot, {'reply'})
        self.assertEqual(cleaned['messages'], [question, call, card])
        self.assertEqual(cleaned['nested']['history'], (question,))
        self.assertEqual(len(snapshot['messages']), 4)

    def test_scrubs_json_messages_without_matching_arbitrary_ids(self):
        value = [{'type': 'ai', 'id': 'reply', 'content': 'deleted'}, {'id': 'reply', 'content': 'not a message'},
                 {'type': 'human', 'id': 'question', 'content': 'retained'}]
        self.assertEqual(scrub_messages(value, {'reply'}), value[1:])

    def test_preserves_delta_snapshot_wrapper_and_finds_reply_in_delta_writes(self):
        reply = AIMessage(content='summary', id='reply')
        question = HumanMessage(content='question', id='question')
        snapshot = _DeltaSnapshot([question, reply])
        self.assertEqual(scrub_messages(snapshot, {'reply'}), _DeltaSnapshot([question]))
        self.assertIs(find_reply(snapshot, 'reply'), reply)
        self.assertIs(find_reply([[reply]], 'reply'), reply)
        self.assertIsNone(find_reply([question], 'question'))


class DeleteReplyRouteTests(unittest.TestCase):
    def setUp(self):
        from chat_http import router
        self.app = FastAPI()
        self.app.include_router(router)
        self.thread_id = '3cb1fb25-e4f3-44b5-9c05-b643b7b68dd6'
        self.saver = SimpleNamespace(
            aget_tuple=AsyncMock(return_value=SimpleNamespace(metadata={'user_id': 'alice'})),
            delete_reply=AsyncMock(),
            delete_turn=AsyncMock(),
        )
        @asynccontextmanager
        async def checkpointer():
            yield self.saver
        self.checkpointer = checkpointer

    def request(self, owner='alice', status='idle'):
        with patch('chat_http.create_checkpointer', self.checkpointer), patch(
            'chat_http.artifact_owner', new_callable=AsyncMock, return_value=owner
        ), patch('chat_http.get_client', return_value=SimpleNamespace(threads=SimpleNamespace(
            get=AsyncMock(return_value={'status': status})
        ))), TestClient(self.app) as client:
            return client.request('DELETE', f'/chat/{self.thread_id}/replies/reply',
                                  headers={'Authorization': 'Bearer verified-token'}, json={'checkpoint_id': 'latest'})

    def test_verified_owner_can_delete_by_identity(self):
        self.assertEqual(self.request().status_code, 200)
        self.saver.delete_reply.assert_awaited_once_with(self.thread_id, 'reply', 'alice', 'latest')

    def test_other_user_cannot_delete(self):
        self.assertEqual(self.request(owner='bob').status_code, 404)
        self.saver.delete_reply.assert_not_awaited()

    def test_busy_thread_cannot_be_modified(self):
        self.assertEqual(self.request(status='busy').status_code, 409)
        self.saver.delete_reply.assert_not_awaited()

    def turn(self, owner='alice', status='idle', human_id='question'):
        with patch('chat_http.create_checkpointer', self.checkpointer), patch(
            'chat_http.artifact_owner', new_callable=AsyncMock, return_value=owner
        ), patch('chat_http.get_client', return_value=SimpleNamespace(threads=SimpleNamespace(
            get=AsyncMock(return_value={'status': status})
        ))), TestClient(self.app) as client:
            return client.request('DELETE', f'/chat/{self.thread_id}/turns/{human_id}',
                                  headers={'Authorization': 'Bearer verified-token'}, json={'checkpoint_id': 'latest'})

    def test_verified_owner_can_delete_a_whole_turn(self):
        response = self.turn()
        self.assertEqual(response.status_code, 200)
        self.saver.delete_turn.assert_awaited_once_with(self.thread_id, 'question', 'alice', 'latest')

    def test_turn_deletion_rejects_busy_thread_and_other_users(self):
        self.assertEqual(self.turn(status='busy').status_code, 409)
        self.assertEqual(self.turn(owner='bob').status_code, 404)
        self.saver.delete_turn.assert_not_awaited()

    def test_checkpoint_conflict_does_not_report_success(self):
        self.saver.delete_reply.side_effect = HTTPException(409, 'changed')
        self.assertEqual(self.request().status_code, 409)
