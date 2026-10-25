"""Tools for language-mentor（英语学习导师）."""

from assistants.language_mentor.tools.highlights import HIGHLIGHT_TOOLS
from assistants.language_mentor.tools.knowledge import KNOWLEDGE_TOOLS
from assistants.language_mentor.tools.markdown import create_markdown
from assistants.language_mentor.tools.understanding import present_understanding_check
from assistants.language_mentor.tools.sentence_structure import present_sentence_structure
from assistants.language_mentor.tools.synonyms import present_synonyms

LOCAL_TOOLS: list = [*KNOWLEDGE_TOOLS, *HIGHLIGHT_TOOLS, create_markdown, present_understanding_check, present_sentence_structure, present_synonyms]
MCP_SERVERS: dict = {}

__all__ = ["LOCAL_TOOLS", "MCP_SERVERS"]
