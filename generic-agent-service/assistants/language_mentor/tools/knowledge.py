"""nature-of-language 笔记库的只读检索工具。

笔记库根目录由环境变量 ``NOL_ROOT`` 指定，默认指向与本仓库平级的
``../nature-of-language``（本地开发布局）。部署时通过 env 改为镜像内路径。

安全约定（web server 场景）：
- 只读：不提供任何写/删能力，不使用 FilesystemBackend/LocalShellBackend；
- 路径校验：所有读取都限制在笔记库根目录内，且仅限 .md 文件；
- 工具出错时返回错误说明字符串而不是抛异常，让 Agent 能自行换策略。
"""

import os
from pathlib import Path

from langchain_core.tools import tool

# assistants/language_mentor/tools/knowledge.py -> 仓库根的上级目录 / nature-of-language
_DEFAULT_ROOT = Path(__file__).resolve().parents[4] / "nature-of-language"

_MAX_LIST = 200
_MAX_SEARCH_RESULTS = 10
_SNIPPETS_PER_FILE = 3
_MAX_CONTENT_CHARS = 20000


def _root() -> Path:
    return Path(os.environ.get("NOL_ROOT", str(_DEFAULT_ROOT))).expanduser().resolve()


def _iter_notes(root: Path):
    for path in sorted(root.rglob("*.md")):
        rel = path.relative_to(root)
        # 跳过 .git / .codebuddy 等隐藏目录，以及给 AI Agent 看的元文档
        if any(part.startswith(".") for part in rel.parts) or path.name == "AGENTS.md":
            continue
        yield path


def _root_unavailable(root: Path) -> str | None:
    if not root.is_dir():
        return f"笔记库目录不存在：{root}。请检查 NOL_ROOT 环境变量配置。"
    return None


@tool
def list_notes() -> str:
    """列出知识库中所有笔记的相对路径，用于了解知识库覆盖哪些主题。当不确定该搜什么关键词时先调用它。"""
    root = _root()
    if err := _root_unavailable(root):
        return err
    paths = [str(p.relative_to(root)) for p in _iter_notes(root)]
    if not paths:
        return "笔记库为空。"
    if len(paths) > _MAX_LIST:
        paths = paths[:_MAX_LIST]
        return "\n".join(paths) + f"\n...（仅显示前 {_MAX_LIST} 条）"
    return "\n".join(paths)


@tool
def search_notes(query: str) -> str:
    """在知识库笔记中按关键词检索（匹配文件名、标题与正文，不区分大小写）。

    Args:
        query: 检索关键词，例如 "介词"、"过去完成时"、"abandon"。一次只传一个核心词。
    """
    root = _root()
    if err := _root_unavailable(root):
        return err
    needle = query.strip().lower()
    if not needle:
        return "检索关键词为空。"

    scored: list[tuple[int, str, list[str]]] = []
    for path in _iter_notes(root):
        rel = str(path.relative_to(root))
        score = 0
        snippets: list[str] = []
        if needle in path.stem.lower():
            score += 10
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for i, line in enumerate(lines, 1):
            if needle in line.lower():
                score += 3 if line.lstrip().startswith("#") else 1
                if len(snippets) < _SNIPPETS_PER_FILE:
                    snippets.append(f"L{i}: {line.strip()[:120]}")
        if score:
            scored.append((score, rel, snippets))

    if not scored:
        return f"未找到与「{query}」相关的笔记。可换个关键词，或先用 list_notes 看看知识库覆盖了哪些主题。"
    scored.sort(key=lambda item: item[0], reverse=True)
    parts = []
    for _, rel, snippets in scored[:_MAX_SEARCH_RESULTS]:
        parts.append(f"## {rel}\n" + "\n".join(snippets))
    return "\n\n".join(parts)


@tool
def read_note(path: str) -> str:
    """按相对路径读取一篇笔记的完整内容（来自 list_notes / search_notes 的结果）。

    Args:
        path: 笔记相对路径，例如 "grammar/不规则动词完全理解手册.md"。
    """
    root = _root()
    if err := _root_unavailable(root):
        return err
    candidate = (root / path).resolve()
    if not candidate.is_relative_to(root):
        return "非法路径：只能读取笔记库目录内的文件。"
    if candidate.suffix != ".md":
        return "只能读取 Markdown（.md）笔记。"
    if not candidate.is_file():
        return f"笔记不存在：{path}。可用 list_notes 或 search_notes 查找正确路径。"
    try:
        content = candidate.read_text(encoding="utf-8")
    except OSError as exc:
        return f"读取失败：{exc}"
    if len(content) > _MAX_CONTENT_CHARS:
        content = content[:_MAX_CONTENT_CHARS] + "\n\n...（笔记过长，已截断）"
    return content


KNOWLEDGE_TOOLS = [list_notes, search_notes, read_note]

__all__ = ["KNOWLEDGE_TOOLS"]
