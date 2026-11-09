"""Authenticated Markdown artifact downloads on the custom LangGraph app."""

import asyncio
from urllib.parse import quote

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse

from core.artifact_auth import artifact_owner
from core.markdown_artifacts import load_markdown

router = APIRouter(prefix='/artifacts', tags=['artifacts'])


@router.get('/{artifact_id}/download')
async def download_markdown(artifact_id: str, request: Request):
    header = request.headers.get('Authorization', '')
    owner = await artifact_owner(header[7:] if header.startswith('Bearer ') else None)
    try:
        filename, content = await asyncio.to_thread(load_markdown, artifact_id, owner)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail='产物不存在或不可访问') from None
    except (OSError, ValueError, KeyError, BotoCoreError, ClientError):
        raise HTTPException(status_code=503, detail='产物暂时不可访问，请稍后重试') from None
    return PlainTextResponse(content, media_type='text/markdown; charset=utf-8', headers={
        'Content-Disposition': f"attachment; filename=lesson.md; filename*=UTF-8''{quote(filename, safe='')}",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
    })
