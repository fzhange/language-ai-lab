"""Turn deletion never treats a tool call as an independent message."""

import unittest

from assistants.language_mentor.turns import keep_other_turns


class MentorTurnTests(unittest.TestCase):
    def test_removes_a_whole_middle_turn_and_preserves_others(self):
        messages = [
            {"type": "human", "id": "h1", "content": "first"},
            {"type": "ai", "id": "a1", "content": "one"},
            {"type": "human", "id": "h2", "content": "second"},
            {"type": "ai", "id": "a2", "content": "", "tool_calls": [{"id": "call2", "name": "search_notes", "args": {"query": "x"}}]},
            {"type": "tool", "id": "t2", "tool_call_id": "call2", "content": "found"},
            {"type": "ai", "id": "a3", "content": "two"},
            {"type": "human", "id": "h3", "content": "third"},
            {"type": "ai", "id": "a4", "content": "three"},
        ]
        retained = keep_other_turns(messages, "h2")
        self.assertEqual([message["id"] for message in retained], ["h1", "a1", "h3", "a4"])
        self.assertEqual([message["id"] for message in messages], ["h1", "a1", "h2", "a2", "t2", "a3", "h3", "a4"])

    def test_rejects_missing_ids_cross_turn_tool_dependencies_and_pending_output(self):
        safe = [
            {"type": "human", "id": "h1", "content": "first"},
            {"type": "ai", "id": "a1", "content": "done"},
            {"type": "human", "id": "h2", "content": "second"},
            {"type": "ai", "id": "a2", "content": "done"},
        ]
        invalid = [
            ({**safe[0], "id": None}, *safe[1:]),
            (safe[0], safe[1], safe[2], {"type": "tool", "id": "t2", "tool_call_id": "missing", "content": "orphan"}),
            (*safe, {"type": "human", "id": "pending", "content": "third"}),
        ]
        for messages in invalid:
            with self.subTest(messages=messages), self.assertRaises(ValueError):
                keep_other_turns(list(messages), "h1")
        with self.assertRaises(LookupError):
            keep_other_turns(safe, "not-a-real-human-id")

    def test_rejects_later_answer_referring_to_removed_check(self):
        messages = [
            {"type": "human", "id": "h1", "content": "first"},
            {"type": "ai", "id": "a1", "tool_calls": [{"id": "check-1", "name": "present_understanding_check", "args": {}}]},
            {"type": "tool", "id": "t1", "tool_call_id": "check-1", "content": "question"},
            {"type": "ai", "id": "a2", "content": "Now answer it"},
            {"type": "human", "id": "h2", "content": '理解检查回答：\n{"check_id":"check-1","question":"x","answer":"y"}'},
            {"type": "ai", "id": "a3", "content": "feedback"},
        ]
        with self.assertRaises(ValueError):
            keep_other_turns(messages, "h1")
