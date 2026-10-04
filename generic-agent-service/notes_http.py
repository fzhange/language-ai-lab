"""nature-of-language 笔记库的只读 HTTP 接口（给前端笔记阅读页用）。

在 langgraph.json 中通过 ``http.app`` 挂载到 LangGraph Server：

- ``GET /notes``        -> [{"path": "...", "title": "..."}] 笔记清单
- ``GET /notes/{path}`` -> text/markdown 原文（path 为清单返回的相对路径）

安全约定与 ``assistants/language_mentor/tools/knowledge.py`` 一致：
只读、仅限 .md、路径必须落在笔记库根目录内（防目录穿越）。
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse

from assistants.language_mentor.tools.knowledge import _iter_notes, _root

app = FastAPI(title="nature-of-language notes API", docs_url=None, redoc_url=None)


def _extract_title(path: Path) -> str:
    """取笔记第一个一级标题作为展示标题，没有则用文件名。"""
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    except OSError:
        pass
    return path.stem


@app.get("/notes")
def list_notes() -> list[dict[str, str]]:
    root = _root()
    if not root.is_dir():
        raise HTTPException(status_code=503, detail="笔记库目录不存在，请检查 NOL_ROOT 配置")
    return [{"path": str(p.relative_to(root)), "title": _extract_title(p)} for p in _iter_notes(root)]


@app.get("/notes/{path:path}", response_class=PlainTextResponse)
def read_note(path: str) -> PlainTextResponse:
    root = _root()
    if not root.is_dir():
        raise HTTPException(status_code=503, detail="笔记库目录不存在，请检查 NOL_ROOT 配置")
    candidate = (root / path).resolve()
    if (
        not candidate.is_relative_to(root)
        or candidate.suffix != ".md"
        or any(part.startswith(".") for part in candidate.relative_to(root).parts)
        or not candidate.is_file()
    ):
        raise HTTPException(status_code=404, detail=f"笔记不存在：{path}")
    return PlainTextResponse(
        candidate.read_text(encoding="utf-8"),
        media_type="text/markdown; charset=utf-8",
    )
