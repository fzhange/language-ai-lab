"""language-mentor 对话图谱工厂（deepagents）。

Referenced by langgraph.json as
`./assistants/language_mentor/agent.py:make_language_mentor`.
"""

from pathlib import Path

from deepagents import create_deep_agent
from langchain_mcp_adapters.client import MultiServerMCPClient

from core.middleware import RepairToolCallsMiddleware
from core.model import get_chat_model
from core.tracing import LANGUAGE_MENTOR, with_trace_tags
from assistants.language_mentor.tools import LOCAL_TOOLS as _LOCAL_TOOLS
from assistants.language_mentor.tools import MCP_SERVERS

_INSTRUCTIONS = (Path(__file__).parent / "prompts" / "instructions.md").read_text(encoding="utf-8")

_MODEL = get_chat_model()


async def make_language_mentor():
    """Async factory: loads MCP tools, then compiles the language-mentor agent.

    Checkpointer/store are injected by the LangGraph server (in-memory locally,
    Postgres in production), so threads persist without extra wiring here.
    """
    mcp_tools = []
    if MCP_SERVERS:
        client = MultiServerMCPClient(MCP_SERVERS)
        mcp_tools = await client.get_tools()
    tools = [*_LOCAL_TOOLS, *mcp_tools]
    graph = create_deep_agent(
        model=_MODEL,
        tools=tools,
        # 代理偶发丢失工具名时按参数签名自愈（见 core/middleware.py）；
        # prefer 消歧：{"query"} 同时命中 search_notes/search_highlights 时优先知识库
        middleware=[RepairToolCallsMiddleware(tools, prefer=["search_notes", "read_note", "list_notes"])],
        system_prompt=_INSTRUCTIONS,
        name=LANGUAGE_MENTOR,
    )
    # 方案 B：本地所有 graph 共用一个 LangSmith 项目，用 tags/metadata 区分来源
    return with_trace_tags(graph, LANGUAGE_MENTOR)
