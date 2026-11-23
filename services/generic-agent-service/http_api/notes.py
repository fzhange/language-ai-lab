"""nature-of-language 笔记库的只读 HTTP 路由（给前端笔记阅读页用）。

- GET /notes        -> [{"path": "...", "title": "..."}] 笔记清单
- GET /notes/{path} -> text/markdown 原文（path 为清单返回的相对路径）

只读、仅限 .md、路径必须落在笔记库根目录内（防目录穿越）。
NOL_ROOT 可覆盖默认的 docs/nature-of-language-knowledge-base 路径。
"""

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

router = APIRouter(tags=["notes"])
_DEFAULT_ROOT = Path(__file__).resolve().parents[3] / "docs" / "nature-of-language-knowledge-base"


def _root() -> Path:
    return Path(os.environ.get("NOL_ROOT", str(_DEFAULT_ROOT))).expanduser().resolve()


def _iter_notes(root: Path):
    for path in sorted(root.rglob("*.md")):
        rel = path.relative_to(root)
        if any(part.startswith(".") for part in rel.parts) or path.name == "AGENTS.md":
            continue
        if path.resolve().is_relative_to(root) and path.is_file():
            yield path


def _extract_title(path: Path) -> str:
    """取笔记第一个一级标题作为展示标题，没有则用文件名。"""
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("# "):
                return line[2:].strip()
    except OSError:
        pass
    return path.stem


@router.get("/notes")
def list_notes() -> list[dict[str, str]]:
    root = _root()
    if not root.is_dir():
        raise HTTPException(status_code=503, detail="笔记库目录不存在，请检查 NOL_ROOT 配置")
    return [{"path": str(p.relative_to(root)), "title": _extract_title(p)} for p in _iter_notes(root)]


@router.get("/notes/{path:path}", response_class=PlainTextResponse)
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
