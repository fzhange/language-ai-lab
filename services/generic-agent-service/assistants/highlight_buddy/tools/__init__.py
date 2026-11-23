"""Tools for highlight-buddy (网页高亮阅读助手).

The assistant's core capabilities (translation, explanation, summary) are
pure LLM + system prompt, so there are no local tools yet. Add reading
related tools (dictionary, translation services) in their own module under
this package and register them in ``LOCAL_TOOLS``.
"""

from assistants.highlight_buddy.tools.mcp import MCP_SERVERS

LOCAL_TOOLS: list = []

__all__ = ["LOCAL_TOOLS", "MCP_SERVERS"]
