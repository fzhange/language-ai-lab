"""独立专项练习：结构校验、仿真题生成及用户绑定的确定性评分。"""

import asyncio
import json
import os
import zlib
from pathlib import Path
from typing import Literal

from cryptography.fernet import Fernet, InvalidToken
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from core.model import get_chat_model

Level = Literal["ielts", "cet", "senior", "junior"]
Topic = Literal["grammar", "reading"]
Source = Literal["authentic", "simulated"]
Choice = Literal["A", "B", "C", "D"]


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    stem: str = Field(min_length=8, max_length=600)
    options: dict[Choice, str]
    answer: Choice
    explanation: str = Field(min_length=5, max_length=1200)
    topic: str = Field(min_length=2, max_length=100)

    @model_validator(mode="after")
    def check_options(self):
        if set(self.options) != {"A", "B", "C", "D"}:
            raise ValueError("每题必须有 A/B/C/D 四个选项")
        if any(not option.strip() or len(option) > 300 for option in self.options.values()):
            raise ValueError("选项内容无效")
        if len({option.strip() for option in self.options.values()}) != 4:
            raise ValueError("选项不能重复")
        return self


class Paper(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    passage: str | None = Field(default=None, max_length=6000)
    questions: list[Question] = Field(min_length=4, max_length=4)

    @model_validator(mode="after")
    def check_unique(self):
        if len({question.id for question in self.questions}) != len(self.questions):
            raise ValueError("题目 ID 重复")
        return self


def validate_paper(raw: object, topic: Topic) -> dict:
    try:
        paper = Paper.model_validate(raw)
    except ValidationError as exc:
        raise ValueError("题目格式无效") from exc
    if topic == "reading" and (not paper.passage or len(paper.passage.strip()) < 100):
        raise ValueError("阅读题缺少文章")
    if topic == "grammar" and paper.passage is not None:
        raise ValueError("语法题不应包含阅读文章")
    return paper.model_dump()


def _cipher() -> Fernet:
    key = os.environ.get("EXAM_SESSION_KEY", "")
    if not key:
        raise RuntimeError("服务端未配置 EXAM_SESSION_KEY")
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as exc:
        raise RuntimeError("EXAM_SESSION_KEY 格式错误") from exc


def issue_paper(raw: object, user_id: str, level: Level, topic: Topic, source: Source,
                origin: dict[str, str] | None = None) -> dict:
    paper = validate_paper(raw, topic)
    if not user_id:
        raise ValueError("未验证用户身份")
    payload = json.dumps({"user": user_id, "paper": paper}, ensure_ascii=False).encode("utf-8")
    session = _cipher().encrypt(zlib.compress(payload)).decode()
    if len(session) > 16000:
        raise ValueError("练习内容过大，无法创建可交卷的试卷")
    return {
        "status": "ready", "level": level, "topic": topic, "source": source,
        "passage": paper["passage"], "origin": origin,
        "questions": [
            {key: question[key] for key in ("id", "stem", "options", "topic")}
            for question in paper["questions"]
        ],
        "session": session,
    }


def grade_paper(session: str, user_id: str, answers: dict[str, Choice]) -> dict:
    if len(session) > 16000 or not session or len(answers) > 4:
        raise ValueError("练习凭据或答案无效")
    try:
        compressed = _cipher().decrypt(session.encode(), ttl=1200)
        unpacker = zlib.decompressobj()
        payload = unpacker.decompress(compressed, 65001)
        if len(payload) > 65000 or not unpacker.eof or unpacker.unused_data or unpacker.unconsumed_tail:
            raise ValueError("练习凭据数据无效")
        data = json.loads(payload)
    except (InvalidToken, ValueError, TypeError, json.JSONDecodeError, zlib.error) as exc:
        raise ValueError("练习已过期或凭据无效，请重新出题") from exc
    if data.get("user") != user_id:
        raise ValueError("练习凭据不属于当前用户")
    paper = Paper.model_validate(data["paper"])
    if set(answers) - {question.id for question in paper.questions}:
        raise ValueError("答案包含不存在的题目")
    results = [
        {
            "id": question.id, "selected": answers.get(question.id),
            "correctAnswer": question.answer,
            "correct": answers.get(question.id) == question.answer,
            "explanation": question.explanation, "topic": question.topic,
        }
        for question in paper.questions
    ]
    return {"score": sum(result["correct"] for result in results), "total": len(results), "results": results}


async def generate_simulated(level: Level, topic: Topic) -> dict:
    prompt = (Path(__file__).parent / "prompts" / "exam_practice.md").read_text(encoding="utf-8")
    model = get_chat_model()
    for attempt in range(2):
        response = await asyncio.wait_for(model.ainvoke([
            SystemMessage(content=prompt),
            HumanMessage(content=f"考试范围: {level}；考点: {topic}。请出 4 道原创四选一练习题，严格返回 JSON。"),
        ]), timeout=45)
        try:
            if not isinstance(response.content, str) or len(response.content) > 24000:
                raise ValueError("模型输出过长或格式不正确")
            return validate_paper(json.loads(response.content), topic)
        except (ValueError, json.JSONDecodeError):
            if attempt == 1:
                raise ValueError("仿真题生成格式错误，请重试") from None
    raise ValueError("仿真题生成失败")
