"""A2A 门面(self-registry + 调用桥接)，挂在 LangGraph Server 的自定义 HTTP app。

发现(Discovery) —— 自注册 / Well-Known URI
--------------------------------------------
- GET /.well-known/agent-card.json      flagship(language-mentor) 卡片
- GET /.well-known/agent.json           同上，兼容旧 A2A 命名
- GET /a2a/agents                       本机注册目录(列出全部 provider 卡片)
- GET /a2a/{id}/.well-known/agent-card.json  单个 agent 卡片

调用(Consumption) —— A2A over JSON-RPC 2.0
-------------------------------------------
- POST /a2a/{id}  method=message/send    一次 A2A Task；provider 直接在进程内 invoke
  自己的 graph（见 _get_graph），返回 completed Task + 文本 artifact。
- POST /a2a/{id}  method=message/stream  仅 streaming 能力的 agent 支持；用
  graph.astream 以 SSE 返回 A2A 流式事件(status-update / artifact-update)。

注意：provider 用进程内 graph.ainvoke/astream，而**不是**回到 LangGraph Server 的
`/runs/*` 队列——否则 mentor 节点内经 call_specialist 再起子 run 会与父 run 争执行器
导致死锁。

身份：需要用户数据的 agent 用 Authorization: Bearer <JWT>，服务端把 token 注入
run config.configurable.supabase_token（与 exam/mentor 一致），绝不取自消息文本。
"""

from __future__ import annotations

import asyncio
import importlib
import inspect
import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from a2a_server.registry import (
    PRIMARY_AGENT_ID,
    build_card,
    build_catalog,
    get_agent,
)

router = APIRouter(tags=["a2a"])
logger = logging.getLogger("a2a")

MAX_MESSAGE_CHARS = 16000
# provider 执行硬超时（秒），防止下游模型/网络异常时 UI 永久卡住
PROVIDER_TIMEOUT = float(os.environ.get("A2A_PROVIDER_TIMEOUT", "150"))

# JSON-RPC 错误码
_PARSE_ERROR = -32700
_INVALID_REQUEST = -32600
_METHOD_NOT_FOUND = -32601
_INVALID_PARAMS = -32602
_INTERNAL_ERROR = -32603

# 已编译图谱缓存：A2A provider 直接在进程内 invoke 自己的 graph，
# 不走 server 运行队列（否则 mentor 节点内再起子 run 会和父 run 争执行器而死锁）。
_GRAPH_CACHE: dict[str, object] = {}

# 专职 provider 执行用的常驻后台事件循环（独立线程）。
# 为什么需要它：consumer（如 mentor）调用时自身正跑在 LangGraph Server 的事件循环里；
# 直接在该循环里 await 子图谱 ainvoke 会因循环/任务组重入而**死锁**。把子图谱丢到这个
# 常驻循环执行，父循环保持空闲；常驻（而非每次新建）可让模型的 async 客户端稳定绑定在
# 同一个循环上，避免 "Event loop is closed" 之类问题。
_worker_loop: asyncio.AbstractEventLoop | None = None
_worker_lock = threading.Lock()


def _provider_loop() -> asyncio.AbstractEventLoop:
    global _worker_loop
    if _worker_loop is None:
        with _worker_lock:
            if _worker_loop is None:
                loop = asyncio.new_event_loop()
                threading.Thread(
                    target=loop.run_forever, name="a2a-provider-loop", daemon=True
                ).start()
                _worker_loop = loop
    return _worker_loop


async def _get_graph(agent):
    cached = _GRAPH_CACHE.get(agent.id)
    if cached is not None:
        return cached
    module_path, attr = agent.factory.split(":")
    factory = getattr(importlib.import_module(module_path), attr)
    graph = factory()
    if inspect.isawaitable(graph):
        graph = await graph
    _GRAPH_CACHE[agent.id] = graph
    return graph


async def run_agent_task(agent, text: str, config: dict) -> str:
    """A2A provider 的核心执行：在**常驻后台事件循环**里跑目标图谱的 ainvoke。

    consumer（如 mentor）调用时自身正跑在 LangGraph Server 的事件循环里；把子图谱丢到
    独立循环执行可避免循环重入死锁（现象：导师思考中…永不返回），父循环仅 await 结果。
    图谱节点多为 async，故必须用 ainvoke（sync invoke 会报 "No synchronous function"）。
    """
    graph = await _get_graph(agent)
    logger.info("a2a provider %s: start (%d chars)", agent.id, len(text))
    future = asyncio.run_coroutine_threadsafe(
        graph.ainvoke({"messages": [{"role": "user", "content": text}]}, config=config),
        _provider_loop(),
    )
    try:
        result = await asyncio.wait_for(asyncio.wrap_future(future), timeout=PROVIDER_TIMEOUT)
    except asyncio.TimeoutError:
        future.cancel()
        raise
    logger.info("a2a provider %s: done", agent.id)
    messages = result.get("messages") if isinstance(result, dict) else None
    if isinstance(messages, list) and messages:
        return _text_from_content(_message_content(messages[-1]))
    return ""


def _message_content(message) -> object:
    """从图谱流式/最终 message（对象或 dict）取 content。"""
    if hasattr(message, "content"):
        return message.content
    if isinstance(message, dict):
        return message.get("content")
    return None


def _base_url(request: Request) -> str:
    return str(request.base_url).rstrip("/")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rpc_error(req_id, code: int, message: str, status: int = 200) -> JSONResponse:
    return JSONResponse(
        {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}},
        status_code=status,
    )


def _text_from_parts(parts) -> str:
    """从 A2A message.parts 中拼出纯文本（忽略非 text part）。"""
    if not isinstance(parts, list):
        return ""
    chunks = []
    for part in parts:
        if isinstance(part, dict) and part.get("kind") == "text":
            text = part.get("text")
            if isinstance(text, str):
                chunks.append(text)
    return "".join(chunks).strip()


def _text_from_content(content) -> str:
    """从 LangGraph 返回的 message.content 抽取文本（兼容 str / 块列表）。"""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        chunks = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                chunks.append(block.get("text", ""))
        return "".join(chunks).strip()
    return ""


def _token_delta(content) -> str:
    """流式 chunk 的增量文本（不 strip，保留空格）。"""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""


def _bearer_config(request: Request) -> dict:
    """把 Authorization bearer JWT 注入 run config，绝不取自消息文本。"""
    config: dict = {"configurable": {}}
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer ") and len(header) <= 4096:
        config["configurable"]["supabase_token"] = header[7:]
    return config


# ---- 发现：自注册卡片 ----


@router.get("/.well-known/agent-card.json")
@router.get("/.well-known/agent.json")
def primary_card(request: Request):
    agent = get_agent(PRIMARY_AGENT_ID)
    return build_card(agent, _base_url(request))


@router.get("/a2a/agents")
def agent_catalog(request: Request):
    return build_catalog(_base_url(request))


@router.get("/a2a/{agent_id}/.well-known/agent-card.json")
@router.get("/a2a/{agent_id}/.well-known/agent.json")
def agent_card(agent_id: str, request: Request):
    agent = get_agent(agent_id)
    if agent is None:
        return JSONResponse({"detail": f"未知 agent：{agent_id}"}, status_code=404)
    return build_card(agent, _base_url(request))


# ---- 调用：A2A JSON-RPC ----


def _parse_envelope(payload):
    """校验 JSON-RPC 信封与 message/send 参数。

    返回 (req_id, method, text, message, error)；error 非 None 时直接回它。
    """
    if not isinstance(payload, dict) or payload.get("jsonrpc") != "2.0":
        req_id = payload.get("id") if isinstance(payload, dict) else None
        return None, None, None, None, _rpc_error(req_id, _INVALID_REQUEST, "缺少或非法的 jsonrpc 版本")
    req_id = payload.get("id")
    method = payload.get("method")
    if method not in {"message/send", "message/stream"}:
        return req_id, method, None, None, _rpc_error(req_id, _METHOD_NOT_FOUND, f"不支持的方法：{method}")
    params = payload.get("params")
    message = params.get("message") if isinstance(params, dict) else None
    if not isinstance(message, dict):
        return req_id, method, None, None, _rpc_error(req_id, _INVALID_PARAMS, "缺少 params.message")
    text = _text_from_parts(message.get("parts"))
    if not text:
        return req_id, method, None, None, _rpc_error(req_id, _INVALID_PARAMS, "message.parts 中没有文本内容")
    if len(text) > MAX_MESSAGE_CHARS:
        return req_id, method, None, None, _rpc_error(req_id, _INVALID_PARAMS, "message 过大")
    return req_id, method, text, message, None


@router.post("/a2a/{agent_id}")
async def a2a_rpc(agent_id: str, request: Request):
    agent = get_agent(agent_id)
    if agent is None:
        return _rpc_error(None, _INVALID_REQUEST, f"未知 agent：{agent_id}", status=404)

    try:
        payload = await request.json()
    except ValueError:
        return _rpc_error(None, _PARSE_ERROR, "请求体不是合法 JSON")

    req_id, method, text, message, error = _parse_envelope(payload)
    if error is not None:
        return error

    config = _bearer_config(request)
    if method == "message/stream":
        if not agent.streaming:
            return _rpc_error(req_id, _METHOD_NOT_FOUND, "该 agent 不支持流式(message/stream)")
        return _stream_response(agent, req_id, text, message, config)
    return await _send(agent, req_id, text, message, config)


async def _send(agent, req_id, text, message, config) -> JSONResponse | dict:
    try:
        reply = await run_agent_task(agent, text, config)
    except asyncio.TimeoutError:
        return _rpc_error(req_id, _INTERNAL_ERROR, "下游图谱处理超时")
    except Exception:
        logger.exception("a2a provider %s failed", agent.id)
        return _rpc_error(req_id, _INTERNAL_ERROR, "下游图谱调用失败")

    context_id = message.get("contextId") or str(uuid.uuid4())
    task = {
        "id": str(uuid.uuid4()),
        "contextId": context_id,
        "kind": "task",
        "status": {"state": "completed", "timestamp": _now()},
        "artifacts": [
            {
                "artifactId": str(uuid.uuid4()),
                "name": f"{agent.id}-result",
                "parts": [{"kind": "text", "text": reply}],
            }
        ],
        "history": [message],
    }
    return {"jsonrpc": "2.0", "id": req_id, "result": task}


def _stream_response(agent, req_id, text, message, config) -> StreamingResponse:
    task_id = str(uuid.uuid4())
    context_id = message.get("contextId") or str(uuid.uuid4())
    artifact_id = str(uuid.uuid4())

    def sse(result: dict) -> str:
        return f"data: {json.dumps({'jsonrpc': '2.0', 'id': req_id, 'result': result}, ensure_ascii=False)}\n\n"

    async def events():
        # 1) 初始 Task（submitted）
        yield sse({
            "id": task_id, "contextId": context_id, "kind": "task",
            "status": {"state": "submitted", "timestamp": _now()},
            "history": [message],
        })
        # 2) working 状态
        yield sse({
            "taskId": task_id, "contextId": context_id, "kind": "status-update",
            "status": {"state": "working", "timestamp": _now()}, "final": False,
        })
        # 3) 流式转发下游 token 为 artifact-update（append）
        state, emitted = "completed", False
        try:
            graph = await _get_graph(agent)
            async for chunk in graph.astream(
                {"messages": [{"role": "user", "content": text}]},
                config=config,
                stream_mode="messages",
            ):
                # messages 模式产出 (message_chunk, metadata)
                msg = chunk[0] if isinstance(chunk, (tuple, list)) and chunk else chunk
                delta = _token_delta(_message_content(msg))
                if not delta:
                    continue
                emitted = True
                yield sse({
                    "taskId": task_id, "contextId": context_id, "kind": "artifact-update",
                    "artifact": {"artifactId": artifact_id, "name": f"{agent.id}-result",
                                 "parts": [{"kind": "text", "text": delta}]},
                    "append": True, "lastChunk": False,
                })
        except Exception:
            state = "failed"
        # 4) 终态
        if emitted:
            yield sse({
                "taskId": task_id, "contextId": context_id, "kind": "artifact-update",
                "artifact": {"artifactId": artifact_id, "parts": []},
                "append": True, "lastChunk": True,
            })
        yield sse({
            "taskId": task_id, "contextId": context_id, "kind": "status-update",
            "status": {"state": state, "timestamp": _now()}, "final": True,
        })

    return StreamingResponse(events(), media_type="text/event-stream")
