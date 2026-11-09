import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from http_api import app
from assistants.language_mentor.tools.a2a_client import call_specialist


def _graph_returning(reply):
    """假 provider graph：ainvoke 返回带最终 AI 文本的 state（run_agent_task 在常驻循环里 await 它）。"""
    return SimpleNamespace(
        ainvoke=AsyncMock(return_value={"messages": [{"content": reply}]})
    )


def _graph_streaming(parts):
    """假 provider graph：astream 以 (message, meta) 逐块产出。"""
    def astream(*_a, **_k):
        async def gen():
            for p in parts:
                yield (SimpleNamespace(content=p, type="ai"), {})
        return gen()
    return SimpleNamespace(astream=astream)


class A2ADiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_primary_wellknown_card(self):
        for path in ("/.well-known/agent-card.json", "/.well-known/agent.json"):
            card = self.client.get(path)
            self.assertEqual(card.status_code, 200, path)
            body = card.json()
            self.assertEqual(body["name"], "Language Mentor")
            self.assertTrue(body["url"].endswith("/a2a/language-mentor"))
            self.assertEqual(body["preferredTransport"], "JSONRPC")
            self.assertTrue(body["skills"])

    def test_catalog_lists_all_providers(self):
        body = self.client.get("/a2a/agents").json()
        ids = {card["url"].rsplit("/", 1)[-1] for card in body["agents"]}
        self.assertEqual(ids, {"language-mentor", "writing-coach", "vocab-quiz"})

    def test_per_agent_card_and_security(self):
        quiz = self.client.get("/a2a/vocab-quiz/.well-known/agent-card.json").json()
        self.assertIn("security", quiz)  # 需要 JWT
        coach = self.client.get("/a2a/writing-coach/.well-known/agent-card.json").json()
        self.assertNotIn("security", coach)  # 无需身份

    def test_unknown_agent_card_404(self):
        self.assertEqual(self.client.get("/a2a/nope/.well-known/agent-card.json").status_code, 404)


class A2ARpcTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def _send(self, text="hello", agent="writing-coach", **params):
        body = {"jsonrpc": "2.0", "id": 7, "method": "message/send",
                "params": {"message": {"role": "user", "kind": "message",
                                        "messageId": "m1",
                                        "parts": [{"kind": "text", "text": text}], **params}}}
        return self.client.post(f"/a2a/{agent}", json=body)

    def test_message_send_bridges_to_graph(self):
        graph = _graph_returning("graded!")
        with patch("a2a_server.http._get_graph", new_callable=AsyncMock, return_value=graph) as gg:
            resp = self._send(text="please grade")
        self.assertEqual(resp.status_code, 200)
        task = resp.json()["result"]
        self.assertEqual(task["status"]["state"], "completed")
        self.assertEqual(task["artifacts"][0]["parts"][0]["text"], "graded!")
        # 解析到正确的 provider，并直接在进程内 invoke 它的 graph（不走 runs 队列）
        self.assertEqual(gg.call_args.args[0].id, "writing-coach")
        graph.ainvoke.assert_awaited_once()

    def test_bearer_token_forwarded_not_from_text(self):
        graph = _graph_returning("ok")
        with patch("a2a_server.http._get_graph", new_callable=AsyncMock, return_value=graph):
            self.client.post("/a2a/vocab-quiz", headers={"Authorization": "Bearer jwt-xyz"},
                             json={"jsonrpc": "2.0", "id": 1, "method": "message/send",
                                   "params": {"message": {"parts": [{"kind": "text", "text": "quiz me"}]}}})
        _, kwargs = graph.ainvoke.call_args
        self.assertEqual(kwargs["config"]["configurable"]["supabase_token"], "jwt-xyz")

    def test_unsupported_method_errors(self):
        body = {"jsonrpc": "2.0", "id": 3, "method": "tasks/cancel", "params": {}}
        err = self.client.post("/a2a/writing-coach", json=body).json()["error"]
        self.assertEqual(err["code"], -32601)

    def test_bad_jsonrpc_version(self):
        err = self.client.post("/a2a/writing-coach", json={"jsonrpc": "1.0", "id": 1}).json()["error"]
        self.assertEqual(err["code"], -32600)

    def test_missing_text_is_invalid_params(self):
        body = {"jsonrpc": "2.0", "id": 5, "method": "message/send",
                "params": {"message": {"parts": []}}}
        err = self.client.post("/a2a/writing-coach", json=body).json()["error"]
        self.assertEqual(err["code"], -32602)

    def test_unknown_agent_rpc_404(self):
        self.assertEqual(self._send(agent="nope").status_code, 404)


class A2AStreamTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def _stream_body(self, agent="language-mentor"):
        return {"jsonrpc": "2.0", "id": 9, "method": "message/stream",
                "params": {"message": {"parts": [{"kind": "text", "text": "hi"}]}}}

    def test_stream_emits_sse_events(self):
        graph = _graph_streaming(["Hel", "lo"])
        with patch("a2a_server.http._get_graph", new_callable=AsyncMock, return_value=graph):
            resp = self.client.post("/a2a/language-mentor", json=self._stream_body())
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.headers["content-type"].startswith("text/event-stream"))
        self.assertIn('"kind": "artifact-update"', resp.text)
        self.assertIn("Hel", resp.text)
        self.assertIn('"state": "completed"', resp.text)
        self.assertIn('"final": true', resp.text)

    def test_stream_unsupported_on_non_streaming_agent(self):
        err = self.client.post("/a2a/writing-coach", json=self._stream_body()).json()["error"]
        self.assertEqual(err["code"], -32601)


class A2AClientToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_call_specialist_forwards_token_and_returns_text(self):
        captured = {}

        async def fake_call(agent_id, text, token):
            captured.update(agent_id=agent_id, text=text, token=token)
            return "four-dimension feedback"

        with patch("assistants.language_mentor.tools.a2a_client._call_agent", side_effect=fake_call):
            out = await call_specialist.ainvoke(
                {"skill": "writing-coach", "request": "my essay"},
                config={"configurable": {"supabase_token": "jwt-abc"}},
            )
        self.assertEqual(out, "four-dimension feedback")
        self.assertEqual(captured, {"agent_id": "writing-coach", "text": "my essay", "token": "jwt-abc"})

    async def test_call_agent_runs_provider_in_process(self):
        # consumer 默认路径：tool -> run_agent_task -> provider graph（独立线程，防死锁）。
        from assistants.language_mentor.tools.a2a_client import _call_agent

        graph = _graph_returning("graded via a2a")
        with patch("a2a_server.http._get_graph", new_callable=AsyncMock, return_value=graph):
            out = await _call_agent("writing-coach", "my essay", "jwt-1")
        self.assertEqual(out, "graded via a2a")
        _, kwargs = graph.ainvoke.call_args
        self.assertEqual(kwargs["config"]["configurable"]["supabase_token"], "jwt-1")


class A2ANoDeadlockTests(unittest.IsolatedAsyncioTestCase):
    """真实图谱（含 async 节点）经 run_agent_task 执行，验证父事件循环不被阻塞。"""

    async def test_real_async_graph_runs_without_blocking_parent_loop(self):
        import asyncio

        from langchain_core.messages import AIMessage
        from langgraph.graph import END, START, MessagesState, StateGraph

        import a2a_server.http as a2ahttp
        from a2a_server.registry import get_agent

        async def _node(state):
            await asyncio.sleep(0.02)  # 真·异步节点
            return {"messages": [AIMessage(content="real-node-ok")]}

        builder = StateGraph(MessagesState)
        builder.add_node("n", _node)
        builder.add_edge(START, "n")
        builder.add_edge("n", END)
        graph = builder.compile()

        ticks = 0

        async def ticker():
            nonlocal ticks
            for _ in range(5):
                await asyncio.sleep(0.01)
                ticks += 1

        with patch.object(a2ahttp, "_get_graph", new_callable=AsyncMock, return_value=graph):
            out, _ = await asyncio.gather(
                a2ahttp.run_agent_task(get_agent("writing-coach"), "hi", {"configurable": {}}),
                ticker(),
            )
            # 第二次调用：验证常驻 worker loop 被复用（不会 "Event loop is closed"）
            again = await a2ahttp.run_agent_task(get_agent("writing-coach"), "hi", {"configurable": {}})
        self.assertEqual(out, "real-node-ok")
        self.assertEqual(again, "real-node-ok")
        self.assertEqual(ticks, 5)  # 父循环全程在跑 => 没有死锁


if __name__ == "__main__":
    unittest.main()
