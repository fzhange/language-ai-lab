"""highlight-buddy 对话图谱工厂（deepagents）。

本地开发：`uv run langgraph dev`；生产：`langgraph build` 出镜像，
配 Postgres（checkpointer/store）+ Redis（queue）部署。
"""

from pathlib import Path

from deepagents import create_deep_agent
from langchain_mcp_adapters.client import MultiServerMCPClient

from core.model import get_chat_model
from core.tracing import HIGHLIGHT_BUDDY, with_trace_tags
from assistants.highlight_buddy.tools import LOCAL_TOOLS as _LOCAL_TOOLS
from assistants.highlight_buddy.tools import MCP_SERVERS

_INSTRUCTIONS = (Path(__file__).parent / "prompts" / "instructions.md").read_text(encoding="utf-8")

_MODEL = get_chat_model()


async def make_highlight_buddy():
    """Async factory: loads MCP tools, then compiles the highlight-buddy agent.

    Referenced by langgraph.json as
    `./assistants/highlight_buddy/agent.py:make_highlight_buddy`.
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
        system_prompt=_INSTRUCTIONS,
        name=HIGHLIGHT_BUDDY,
    )
    # 方案 B：本地所有 graph 共用一个 LangSmith 项目，用 tags/metadata 区分来源
    return with_trace_tags(graph, HIGHLIGHT_BUDDY)
