"""Turn deletion must work on what checkpoints really store: LangChain message objects."""

import unittest

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.checkpoint.serde.types import _DeltaSnapshot

from assistants.language_mentor.turns import keep_other_turns
from core.message_deletion import as_message_dicts, scrub_messages


def conversation():
    return [
        HumanMessage(content='查找近义词请求：\nbased on', id='q1'),
        AIMessage(content='', id='a1', tool_calls=[{'id': 'call-1', 'name': 'present_synonyms', 'args': {}}]),
        ToolMessage(content='{"type":"synonym_comparison"}', id='t1', tool_call_id='call-1', name='present_synonyms'),
        AIMessage(content='已为您展示', id='a2'),
        HumanMessage(content='next question', id='q2'),
        AIMessage(content='answer', id='a3'),
    ]


class TurnDeletionStorageTests(unittest.TestCase):
    def test_one_message_per_write_still_rebuilds_a_complete_conversation(self):
        """LangGraph often saves each step as its own write holding a single message."""
        writes = [[m] for m in conversation()]
        # No single stored value contains the question AND its whole turn, so validating one value fails.
        single = as_message_dicts(writes[0])
        with self.assertRaises(ValueError):
            keep_other_turns(single, 'q1')
        history = {}
        for write in writes:
            for message in as_message_dicts(write):
                history[message['id']] = message
        retained = keep_other_turns(list(history.values()), 'q1')
        self.assertEqual([m['id'] for m in retained], ['q2', 'a3'])

    def test_finds_and_removes_a_whole_turn_stored_as_message_objects(self):
        flat = as_message_dicts(conversation())
        self.assertEqual([m['id'] for m in flat], ['q1', 'a1', 't1', 'a2', 'q2', 'a3'])
        retained = keep_other_turns(flat, 'q1')
        removed = {m['id'] for m in flat} - {m['id'] for m in retained}
        self.assertEqual(removed, {'q1', 'a1', 't1', 'a2'})
        cleaned = scrub_messages(conversation(), removed)
        self.assertEqual([m.id for m in cleaned], ['q2', 'a3'])

    def test_survives_a_real_serialization_round_trip_and_delta_snapshots(self):
        serde = JsonPlusSerializer()
        for value in (conversation(), _DeltaSnapshot(conversation())):
            kind, blob = serde.dumps_typed(value)
            flat = as_message_dicts(serde.loads_typed((kind, blob)))
            self.assertEqual([m['id'] for m in flat], ['q1', 'a1', 't1', 'a2', 'q2', 'a3'])
            self.assertEqual(keep_other_turns(flat, 'q2')[-1]['id'], 'a2')

    def test_tool_card_identity_is_preserved_for_dependency_checks(self):
        flat = as_message_dicts(conversation())
        tool = next(m for m in flat if m['id'] == 't1')
        self.assertEqual(tool['tool_call_id'], 'call-1')
        self.assertEqual(next(m for m in flat if m['id'] == 'a1')['tool_calls'][0]['id'], 'call-1')


if __name__ == '__main__':
    unittest.main()
