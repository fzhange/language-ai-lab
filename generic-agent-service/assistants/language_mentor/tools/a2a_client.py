"""A2A client：让 language-mentor 作为 consumer，远程调用专职 agent。

闭环说明
========
mentor 不再把写作批改/词汇测验塞进自己的 prompt，而是通过 A2A 协议把任务委派给
独立的 provider agent（writing-coach / vocab-quiz）。

两种传输：
- 默认（同进程）：直接调用 ``a2a_server.http.run_agent_task``，provider 在**独立线程**
  里跑自己的 graph。不走自环 HTTP，也不把子 run 塞回 LangGraph Server 的运行队列/事件
  循环——否则 consumer 正跑在该循环里时会**死锁**（导师思考中…永不返回）。
- 远程（设了 env ``A2A_BASE_URL``）：走真实 A2A JSON-RPC over HTTP，用于 provider 部署
  在别的进程/机器时的真协议互通。

身份红线：用户 JWT 从 run config.configurable.supabase_token 读出；本机路径注入
run config.configurable，远程路径经 Authorization 头透传，均不取自对话文本。
"""

import asyncio
import os
import uuid
from typing import Literal

import httpx
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

# 可委派的专职 agent（与 a2a_server.registry.AGENTS / langgraph.json 对齐）
Specialist = Literal["writing-coach", "vocab-quiz"]
_TIMEOUT = 160.0


async def _call_remote(agent_id: str, text: str, token: str | None, base: str) -> str:
    """远程 provider：真实 A2A JSON-RPC over HTTP（设了 A2A_BASE_URL 时启用）。"""
    body = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "message/send",
        "params": {
            "message": {
                "role": "user",
                "kind": "message",
                "messageId": str(uuid.uuid4()),
                "parts": [{"kind": "text", "text": text}],
            }
        },
    }
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        async with httpx.AsyncClient(base_url=base.rstrip("/"), timeout=_TIMEOUT) as client:
            resp = await client.post(f"/a2a/{agent_id}", json=body, headers=headers)
    except httpx.HTTPError as exc:
        return f"调用 {agent_id} 时网络出错：{type(exc).__name__}: {exc}"
    if resp.status_code != 200:
        return f"调用 {agent_id} 失败（HTTP {resp.status_code}）：{resp.text[:200]}"
    try:
        payload = resp.json()
    except ValueError:
        return f"{agent_id} 返回了非 JSON 响应。"
    if "error" in payload:
        return f"{agent_id} 返回错误：{payload['error'].get('message', '未知错误')}"
    artifacts = (payload.get("result") or {}).get("artifacts") or []
    chunks = []
    for artifact in artifacts:
        for part in artifact.get("parts", []):
            if part.get("kind") == "text" and part.get("text"):
                chunks.append(part["text"])
    return "\n".join(chunks).strip() or f"{agent_id} 没有返回内容。"


async def _call_agent(agent_id: str, text: str, token: str | None) -> str:
    """委派给 provider：默认同进程直跑（独立线程，防死锁），远程则走 A2A HTTP。"""
    base = os.environ.get("A2A_BASE_URL", "").strip()
    if base:
        return await _call_remote(agent_id, text, token, base)
    # 同进程：直接执行 provider 的 graph（与 A2A 端点共用 run_agent_task）
    from a2a_server.http import run_agent_task
    from a2a_server.registry import get_agent

    agent = get_agent(agent_id)
    if agent is None:
        return f"未知 agent：{agent_id}"
    config = {"configurable": {"supabase_token": token} if token else {}}
    try:
        reply = await run_agent_task(agent, text, config)
    except asyncio.TimeoutError:
        return f"{agent_id} 处理超时，请稍后重试或缩短输入。"
    except Exception as exc:
        return f"调用 {agent_id} 失败：{type(exc).__name__}: {exc}"
    return reply or f"{agent_id} 没有返回内容。"


@tool
async def call_specialist(skill: Specialist, request: str, config: RunnableConfig) -> str:
    """把专项任务委派给独立的专职 agent（经 A2A 协议远程调用）。

    何时使用：
    - 用户要批改英文作文/雅思写作 → skill="writing-coach"，request 传作文全文。
    - 用户要基于自己的高亮做词汇测验/对答案 → skill="vocab-quiz"，request 传用户诉求。

    不要用它处理普通对话讲解；返回的是该 agent 的完整结果，按需转述给用户。

    Args:
        skill: 目标专职 agent：writing-coach 或 vocab-quiz。
        request: 传给该 agent 的完整请求文本（作文原文或测验诉求）。
    """
    token = (config.get("configurable") or {}).get("supabase_token")
    return await _call_agent(skill, request, token)


A2A_CLIENT_TOOLS = [call_specialist]

__all__ = ["A2A_CLIENT_TOOLS", "call_specialist", "_call_agent"]
