import asyncio
import os
import unittest
from unittest.mock import AsyncMock, patch

from cryptography.fernet import Fernet

from assistants.language_mentor.exam_practice import grade_paper, issue_paper, validate_paper


GRAMMAR = {
    "passage": None,
    "questions": [
        {
            "id": f"q{i}",
            "stem": f"Choose the right answer for item {i}.",
            "options": {"A": "is", "B": "are", "C": "was", "D": "were"},
            "answer": "B",
            "explanation": "复数主语搭配 are。",
            "topic": "主谓一致",
        }
        for i in range(1, 5)
    ],
}


class ExamPracticeTests(unittest.TestCase):
    def setUp(self):
        self.key = Fernet.generate_key().decode()
        self.env = patch.dict(os.environ, {"EXAM_SESSION_KEY": self.key})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_issued_paper_hides_correct_answers_until_grading(self):
        published = issue_paper(GRAMMAR, "user-one", "cet", "grammar", "simulated")
        self.assertEqual(published["status"], "ready")
        self.assertEqual(published["source"], "simulated")
        self.assertNotIn('"answer"', str(published))
        self.assertNotIn("explanation", str(published))
        self.assertEqual(len(published["questions"]), 4)
        result = grade_paper(published["session"], "user-one", {"q1": "B", "q2": "A", "q3": "B", "q4": "B"})
        self.assertEqual(result["score"], 3)
        self.assertEqual(result["total"], 4)
        self.assertEqual(result["results"][1]["correctAnswer"], "B")
        self.assertIn("复数主语", result["results"][1]["explanation"])

    def test_issued_paper_with_long_chinese_explanations_remains_gradeable(self):
        questions = [{**question, "explanation": "语法解释及例句。" * 110} for question in GRAMMAR["questions"]]
        session = issue_paper({"passage": None, "questions": questions}, "user-one", "cet", "grammar", "simulated")["session"]
        self.assertLessEqual(len(session), 16000)
        self.assertEqual(grade_paper(session, "user-one", {"q1": "B"})["score"], 1)

    def test_other_user_cannot_grade_or_tamper_with_session(self):
        session = issue_paper(GRAMMAR, "user-one", "cet", "grammar", "simulated")["session"]
        with self.assertRaises(ValueError):
            grade_paper(session, "user-two", {"q1": "B"})
        with self.assertRaises(ValueError):
            grade_paper(session[:-3] + "abc", "user-one", {"q1": "B"})
        with self.assertRaises(ValueError):
            grade_paper(session, "user-one", {"wrong-id": "A"})

    def test_expired_session_rejected(self):
        import time
        session = issue_paper(GRAMMAR, "user-one", "cet", "grammar", "simulated")["session"]
        with patch("cryptography.fernet.time.time", return_value=time.time() + 1201):
            with self.assertRaisesRegex(ValueError, "过期"):
                grade_paper(session, "user-one", {})

    def test_invalid_model_output_is_not_served(self):
        invalid = {**GRAMMAR, "questions": [{**GRAMMAR["questions"][0], "answer": "E"}]}
        with self.assertRaises(ValueError):
            validate_paper(invalid, "grammar")
        with self.assertRaises(ValueError):
            validate_paper(GRAMMAR, "reading")
        with self.assertRaises(ValueError):
            validate_paper({**GRAMMAR, "questions": [GRAMMAR["questions"][0]] * 4}, "grammar")

    def test_simulated_generation_retries_invalid_output_then_succeeds(self):
        from assistants.language_mentor.exam_practice import generate_simulated
        import json
        from langchain_core.messages import AIMessage

        model = AsyncMock()
        model.ainvoke.side_effect = [AIMessage(content="not JSON"), AIMessage(content=json.dumps(GRAMMAR))]
        with patch("assistants.language_mentor.exam_practice.get_chat_model", return_value=model):
            paper = asyncio.run(generate_simulated("cet", "grammar"))
        self.assertEqual(paper["questions"][0]["answer"], "B")
        self.assertEqual(model.ainvoke.await_count, 2)


if __name__ == "__main__":
    unittest.main()
