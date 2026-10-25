"""Bounded OpenUI learning interactions carried by ordinary tool messages."""

import json

from langchain.tools import tool
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator


class UnderstandingCheck(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    question: str = Field(min_length=1, max_length=1200)
    options: list[str] = Field(min_length=2, max_length=4)

    @field_validator("question")
    @classmethod
    def meaningful_question(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Question cannot be blank")
        return value.strip()

    @field_validator("options")
    @classmethod
    def meaningful_options(cls, values: list[str]) -> list[str]:
        values = [value.strip() for value in values]
        if any(not value or len(value) > 600 for value in values):
            raise ValueError("Options must contain 1 to 600 characters")
        if len(set(values)) != len(values):
            raise ValueError("Options must be distinct")
        return values


@tool
def present_understanding_check(question: str, options: list[str]) -> dict:
    """在导师回复中展示一个 OpenUI 单选理解检查，而不是死记硬背测试。

    Args:
        question: 结合当前讲解，要求判断含义或将原理迁移到新例子的问题。
        options: 2 至 4 个不同的选项，仅一个最合适；不要提前标出正确答案。
    """
    try:
        check = UnderstandingCheck(question=question, options=options)
    except ValidationError:
        return {"error": "理解检查格式无效：问题最多 1200 字，提供 2 至 4 个不同的非空选项，每项最多 600 字。"}
    # JSON string literals prevent learner content from becoming OpenUI code.
    response = f"root = UnderstandingCheck({json.dumps(check.question, ensure_ascii=False)}, {json.dumps(check.options, ensure_ascii=False)})"
    return {"type": "understanding_check", "version": 1, **check.model_dump(), "response": response}
