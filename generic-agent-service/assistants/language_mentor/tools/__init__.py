"""Tools for language-mentor（英语学习导师）."""

from assistants.language_mentor.tools.highlights import HIGHLIGHT_TOOLS
from assistants.language_mentor.tools.knowledge import KNOWLEDGE_TOOLS

LOCAL_TOOLS: list = [*KNOWLEDGE_TOOLS, *HIGHLIGHT_TOOLS]
MCP_SERVERS: dict = {}

__all__ = ["LOCAL_TOOLS", "MCP_SERVERS"]
