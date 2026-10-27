"""Validate model-produced synonym comparisons for the mentor UI."""

from langchain.tools import tool
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


class Alternative(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    term: str = Field(min_length=1, max_length=80)
    distinction: str = Field(min_length=1, max_length=350)
    example: str = Field(min_length=1, max_length=240)


class SynonymComparison(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    source: str = Field(min_length=1, max_length=120)
    shared_meaning: str = Field(min_length=1, max_length=350)
    source_distinction: str = Field(min_length=1, max_length=350)
    source_example: str = Field(min_length=1, max_length=240)
    alternatives: list[Alternative] = Field(min_length=1, max_length=5)

    @model_validator(mode="after")
    def validate_comparison(self):
        if not self.source.strip() or not self.shared_meaning.strip() or not self.source_distinction.strip() or not self.source_example.strip():
            raise ValueError("Source word needs a meaning, distinction and example")
        seen = {" ".join(self.source.split()).casefold()}
        for alternative in self.alternatives:
            term = " ".join(alternative.term.split()).casefold()
            if not term or term in seen or not alternative.distinction.strip() or not alternative.example.strip():
                raise ValueError("Alternatives must be distinct and explain their usage")
            seen.add(term)
        return self


@tool
def present_synonyms(source: str, shared_meaning: str, source_distinction: str, source_example: str, alternatives: list[dict]) -> dict:
    """将已生成的英文近义表达辨析校验并展示为卡片，帮助用户判断不同语境下该选哪个表达。

    仅在用户消息以「查找近义词请求：」开头时调用；普通聊天或标有「用户原文（非工具请求）：」的消息不触发此工具。
    本工具不检索或生成近义词，需先准备同一语义下的可靠比较。重点说明语义侧重、正式程度、语气或常见搭配，
    不要只给重复的中文释义，也不要暗示所有表达可以任意互换。每轮只调用一次；若输入不是英文词或短语、
    没有可靠的相近表达，或工具返回 error，直接用 Markdown 说明，不编造候选词或反复调用。

    Args:
        source: 请求前缀后的英文单词或短语，逐字保留，不改写为词根或其他表达。
        shared_meaning: 用一句简短中文说明本次比较的共同语义；多义词只比较一个相关义项。
        source_distinction: 用简短中文说明源词相对于候选词的侧重点、适用语境或常见搭配，回答「什么时候更适合用原词」。
        source_example: 一个自然、简短的英文例句，体现源词在所比较义项下的用法，并与 source_distinction 一致。
        alternatives: 1 至 5 个同一语义下的相关英文词或短语，不凑数量，不重复源词或其他候选词。
            每项仅包含 term（候选表达）、distinction（简短中文，说明与源词及其他候选词的关键区别和适用场景）
            和 example（自然、简短的英文例句，体现该区别）；避免用同一句话机械替换单词来充当辨析。
    """
    try:
        comparison = SynonymComparison(source=source, shared_meaning=shared_meaning, source_distinction=source_distinction, source_example=source_example, alternatives=alternatives)
    except ValidationError:
        return {"error": "近义词辨析数据不完整或有重复；请核对输入、差异与例句，并重试或用文字说明。"}
    return {"type": "synonym_comparison", "version": 1, **comparison.model_dump()}
