"""用户高亮数据查询（Supabase whw_highlights，只读）。

授权模型：前端把用户的 Supabase 会话 JWT 经 run config 的
``configurable.supabase_token`` 传入；本模块用 anon key + 该 JWT 走 PostgREST，
由 RLS 保证只能读到该用户自己的数据。服务端不持有 service key。

需要的环境变量：``SUPABASE_URL``、``SUPABASE_ANON_KEY``。
"""

import os
from typing import Any
from urllib.parse import quote

import httpx
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

TABLE = "whw_highlights"
SELECT = "page_title,page_url,exact,note,insight,created_at"
_TIMEOUT = 15.0


def _base_config(config: RunnableConfig) -> tuple[str, dict[str, str]] | str:
    """返回 (base_url, headers)；配置缺失时返回错误说明字符串。"""
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    anon = os.environ.get("SUPABASE_ANON_KEY", "")
    if not url or not anon:
        return "服务端未配置 SUPABASE_URL / SUPABASE_ANON_KEY，无法访问高亮数据。"
    token = (config.get("configurable") or {}).get("supabase_token")
    if not token:
        return "用户未登录（缺少 supabase_token），无法读取 ta 的高亮数据。请提示用户在网页上登录。"
    headers = {"apikey": anon, "Authorization": f"Bearer {token}"}
    return f"{url}/rest/v1/{TABLE}", headers


def _format_rows(rows: list[dict[str, Any]]) -> str:
    parts = []
    for r in rows:
        lines = [
            f"- 原文：{r.get('exact', '')}",
            f"  页面：《{r.get('page_title', '')}》 {r.get('page_url', '')}",
        ]
        if r.get("note"):
            lines.append(f"  笔记：{r['note']}")
        if r.get("insight"):
            lines.append(f"  心得：{r['insight']}")
        if r.get("created_at"):
            lines.append(f"  时间：{str(r['created_at'])[:10]}")
        parts.append("\n".join(lines))
    return "\n".join(parts)


async def fetch_highlights(
    config: RunnableConfig, query: str | None = None, limit: int = 10
) -> tuple[bool, str]:
    """查询高亮的共用入口。返回 (成功与否, 文本)：成功为格式化数据，失败为错误说明。"""
    base = _base_config(config)
    if isinstance(base, str):
        return False, base
    url, headers = base
    limit = min(max(limit, 1), 50)
    if query and query.strip():
        needle = quote(f"*{query.strip()}*")
        # PostgREST or 条件需手工拼进 query string
        qs = (
            f"select={SELECT}&deleted_at=is.null&order=created_at.desc&limit={limit}"
            f"&or=(exact.ilike.{needle},note.ilike.{needle},insight.ilike.{needle})"
        )
    else:
        qs = f"select={SELECT}&deleted_at=is.null&order=created_at.desc&limit={limit}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{url}?{qs}", headers=headers)
    except httpx.HTTPError as exc:
        return False, f"查询高亮时网络出错：{exc}"
    if resp.status_code != 200:
        return False, f"查询高亮失败（HTTP {resp.status_code}）：{resp.text[:200]}"
    rows = resp.json()
    if not rows:
        if query:
            return False, f"用户的高亮里没有找到与「{query}」相关的内容。"
        return False, "该用户还没有高亮数据。可以建议 ta 先用 Words Highlight 插件在网页上划词。"
    return True, _format_rows(rows)


@tool
async def get_recent_highlights(config: RunnableConfig, limit: int = 10) -> str:
    """获取用户最近在浏览器插件里划线高亮的内容（原文、所在页面、笔记、心得）。

    Args:
        limit: 返回条数，默认 10，最大 50。
    """
    _, text = await fetch_highlights(config, limit=limit)
    return text


@tool
async def search_highlights(query: str, config: RunnableConfig, limit: int = 10) -> str:
    """在用户的高亮数据里按关键词检索（匹配原文、笔记、心得，不区分大小写）。

    Args:
        query: 检索关键词，例如 "abandon"、"虚拟语气"。
        limit: 返回条数，默认 10，最大 50。
    """
    _, text = await fetch_highlights(config, query=query, limit=limit)
    return text


HIGHLIGHT_TOOLS = [get_recent_highlights, search_highlights]

__all__ = ["HIGHLIGHT_TOOLS", "fetch_highlights"]
