import os
import unittest
from unittest.mock import AsyncMock, patch

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from assistants.language_mentor.exam_practice import issue_paper
from notes_http import app

from test_exam_practice import GRAMMAR


class ExamHttpTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"EXAM_SESSION_KEY": Fernet.generate_key().decode()})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = TestClient(app)

    def test_unauthenticated_requests_are_rejected(self):
        response = self.client.post("/exam/papers", json={"level": "cet", "topic": "grammar", "source": "simulated"})
        self.assertEqual(response.status_code, 401)
        response = self.client.post("/exam/grade", json={"session": "invalid", "answers": {}})
        self.assertEqual(response.status_code, 401)

    def test_authenticated_issue_and_grade_never_accept_user_id_from_body(self):
        with patch("exam_http._verified_user", new_callable=AsyncMock, return_value="real-user"), patch(
            "exam_http.generate_simulated", new_callable=AsyncMock, return_value=GRAMMAR
        ):
            response = self.client.post("/exam/papers", headers={"Authorization": "Bearer valid-token"}, json={
                "level": "cet", "topic": "grammar", "source": "simulated"
            })
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("answer", response.json()["questions"][0])
            session = response.json()["session"]
            result = self.client.post("/exam/grade", headers={"Authorization": "Bearer valid-token"}, json={
                "session": session, "answers": {"q1": "B", "q2": "B", "q3": "B", "q4": "B"}
            })
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["score"], 4)
            wrong_user = self.client.post("/exam/grade", headers={"Authorization": "Bearer valid-token"}, json={
                "session": session, "answers": {}, "user_id": "real-user"
            })
            self.assertEqual(wrong_user.status_code, 422)

    def test_invalid_scope_or_answers_rejected(self):
        with patch("exam_http._verified_user", new_callable=AsyncMock, return_value="real-user"):
            response = self.client.post("/exam/papers", headers={"Authorization": "Bearer valid-token"}, json={
                "level": "unknown", "topic": "grammar", "source": "simulated"
            })
            self.assertEqual(response.status_code, 422)
            session = issue_paper(GRAMMAR, "real-user", "cet", "grammar", "simulated")["session"]
            result = self.client.post("/exam/grade", headers={"Authorization": "Bearer valid-token"}, json={
                "session": session, "answers": {"q1": "E"}
            })
            self.assertEqual(result.status_code, 422)

    def test_unlicensed_originals_return_explicit_empty_state(self):
        with patch("exam_http._verified_user", new_callable=AsyncMock, return_value="real-user"):
            response = self.client.post("/exam/papers", headers={"Authorization": "Bearer valid-token"}, json={
                "level": "cet", "topic": "reading", "source": "authentic"
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "empty")
        self.assertNotIn("session", response.json())

    def test_licensed_originals_use_same_answer_flow_and_provenance(self):
        original = {"paper": GRAMMAR, "origin": {"name": "许可来源", "url": "https://example.com", "year": "2024", "region": "全国"}}
        with patch("exam_http._verified_user", new_callable=AsyncMock, return_value="real-user"), patch(
            "exam_http.select_authentic", return_value=original
        ):
            response = self.client.post("/exam/papers", headers={"Authorization": "Bearer valid-token"}, json={
                "level": "cet", "topic": "grammar", "source": "authentic"
            })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["source"], "authentic")
        self.assertEqual(response.json()["origin"]["name"], "许可来源")
        self.assertNotIn("answer", response.json()["questions"][0])

    def test_excessive_request_body_rejected_before_auth_or_model_call(self):
        response = self.client.post("/exam/papers", headers={"Authorization": "Bearer token"},
                                    content=b"x" * 25000)
        self.assertEqual(response.status_code, 413)

    def test_supabase_identity_not_taken_from_unverified_token(self):
        import asyncio
        from starlette.requests import Request
        from fastapi import HTTPException
        from exam_http import _verified_user

        request = Request({"type": "http", "method": "POST", "path": "/exam/papers", "headers": [
            (b"authorization", b"Bearer forged-token")
        ]})
        with patch.dict(os.environ, {"SUPABASE_URL": "https://auth.example.com", "SUPABASE_ANON_KEY": "public-key"}), patch(
            "exam_http.httpx.AsyncClient.get", new_callable=AsyncMock
        ) as get:
            get.return_value.status_code = 401
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(_verified_user(request))
        self.assertEqual(raised.exception.status_code, 401)

    def test_model_provider_error_returns_actionable_generation_failure(self):
        with patch("exam_http._verified_user", new_callable=AsyncMock, return_value="real-user"), patch(
            "exam_http.generate_simulated", new_callable=AsyncMock, side_effect=ConnectionError("model unavailable")
        ):
            response = self.client.post("/exam/papers", headers={"Authorization": "Bearer valid-token"}, json={
                "level": "cet", "topic": "grammar", "source": "simulated"
            })
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("model unavailable", response.text)

    def test_existing_notes_route_unchanged(self):
        self.assertNotEqual(self.client.get("/notes").status_code, 404)


if __name__ == "__main__":
    unittest.main()
