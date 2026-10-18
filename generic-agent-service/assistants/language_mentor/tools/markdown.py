"""Create downloadable Markdown lessons only after HITL approval."""

import asyncio

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException
from langchain.tools import ToolRuntime, tool

from core.artifact_auth import artifact_owner
from core.markdown_artifacts import save_markdown


@tool
async def create_markdown(filename: str, content: str, runtime: ToolRuntime) -> dict[str, str]:
    """创建可下载的 Markdown 教案或学习材料；必须先在网页上批准后才保存。

    Args:
        filename: 普通 .md 文件名，例如 present-perfect.md，不能包含目录。
        content: 完整 Markdown 内容，包括标题、讲解和例句，最大 200 KB。
    """
    config = runtime.config.get('configurable') or {}
    try:
        owner = await artifact_owner(config.get('supabase_token'))
        return await asyncio.to_thread(save_markdown, owner=owner, thread_id=config.get('thread_id'),
                                       tool_call_id=runtime.tool_call_id, filename=filename, content=content)
    except HTTPException as exc:
        return {'error': str(exc.detail)}
    except (ValueError, OSError, BotoCoreError, ClientError):
        return {'error': 'Markdown 创建失败，请检查文件名、内容及对象存储配置；不要重复尝试未经批准的替代写入。'}
