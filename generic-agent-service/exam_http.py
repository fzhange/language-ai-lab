"""LangGraph Server 自定义 HTTP 路由：独立专项练习。"""

import asyncio
import logging
import os
import time
from collections import defaultdict, deque
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from assistants.language_mentor.exam_catalog import select_authentic
from assistants.language_mentor.exam_practice import (
    Choice, Level, Source, Topic, generate_simulated, grade_paper, issue_paper,
)

router = APIRouter(prefix="/exam", tags=["exam"])
_requests: dict[str, deque[float]] = defaultdict(deque)


class PaperRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    level: Level
    topic: Topic
    source: Source


class GradeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    session: str = Field(min_length=1, max_length=16000)
    answers: dict[str, Choice] = Field(max_length=4)


async def _verified_user(request: Request) -> str:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer ") or len(header) > 4096:
        raise HTTPException(status_code=401, detail="请先登录后再开始练习")
    token = header[7:]
    if not token or any(char.isspace() for char in token):
        raise HTTPException(status_code=401, detail="登录凭证无效")
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    anon = os.environ.get("SUPABASE_ANON_KEY", "")
    parsed = urlsplit(base)
    if not anon or parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.path:
        raise HTTPException(status_code=503, detail="身份服务尚未正确配置")
    try:
        async with httpx.AsyncClient(timeout=6, follow_redirects=False) as client:
            response = await client.get(f"{base}/auth/v1/user", headers={
                "apikey": anon, "Authorization": f"Bearer {token}",
            })
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="身份服务暂不可用") from exc
    if response.status_code != 200:
        raise HTTPException(status_code=401, detail="登录已失效，请重新登录")
    try:
        user_id = response.json()["id"]
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=503, detail="身份服务响应无效") from exc
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(status_code=503, detail="身份服务响应无效")
    return user_id


def _limit(user_id: str, operation: str, max_requests: int) -> None:
    now = time.monotonic()
    timestamps = _requests[f"{operation}:{user_id}"]
    while timestamps and now - timestamps[0] >= 60:
        timestamps.popleft()
    if len(timestamps) >= max_requests:
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")
    timestamps.append(now)
    if len(_requests) > 10000:
        for key in list(_requests):
            if not _requests[key] or now - _requests[key][-1] >= 60:
                del _requests[key]


@router.post("/papers")
async def create_paper(payload: PaperRequest, request: Request):
    user_id = await _verified_user(request)
    _limit(user_id, "generate", 5)
    if payload.source == "authentic":
        try:
            selection = select_authentic(payload.level, payload.topic)
            if selection is None:
                return {"status": "empty", "message": "当前范围尚无获得站内使用授权的真题，请选择 AI 仿真原创练习。"}
            return issue_paper(selection["paper"], user_id, payload.level, payload.topic, payload.source,
                               selection["origin"])
        except ValueError as exc:
            raise HTTPException(status_code=503, detail="真题题库暂不可用") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail="练习服务未配置完成") from exc
    try:
        paper = await generate_simulated(payload.level, payload.topic)
    except (ValueError, asyncio.TimeoutError) as exc:
        raise HTTPException(status_code=502, detail="仿真题生成失败，请稍后重试") from exc
    except Exception as exc:
        logging.getLogger(__name__).warning("exam_generation_failed exception_type=%s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="仿真题生成失败，请稍后重试") from exc
    try:
        return issue_paper(paper, user_id, payload.level, payload.topic, payload.source)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="生成的练习内容过大，请重新出题") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="练习服务未配置完成") from exc


@router.post("/grade")
async def submit_paper(payload: GradeRequest, request: Request):
    user_id = await _verified_user(request)
    _limit(user_id, "grade", 30)
    try:
        return grade_paper(payload.session, user_id, payload.answers)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="练习服务未配置完成") from exc
