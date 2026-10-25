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
    """展示输入词或短语的相近表达及它们之间的使用区别；仅在用户选择「查找近义词」后调用。

    Args:
        source: 用户输入的英文单词或短语，逐字保留。
        shared_meaning: 用一句简短中文概括这组词在此语义下的共同点；不要宣称它们可以任意互换。
        source_distinction: 输入词本身相对于候选词的侧重点、语境或常见搭配，用简短中文说明。
        source_example: 体现输入词本身侧重点的简短英文例句。
        alternatives: 1 至 5 个确实相关的词或短语；每项包含 term（候选词）、distinction（中文说明与源词及其他候选词的语境/语气/搭配区别）和 example（能体现该区别的简短英文例句）。不要凑数量或重复输入词。
    """
    try:
        comparison = SynonymComparison(source=source, shared_meaning=shared_meaning, source_distinction=source_distinction, source_example=source_example, alternatives=alternatives)
    except ValidationError:
        return {"error": "近义词辨析数据不完整或有重复；请核对输入、差异与例句，并重试或用文字说明。"}
    return {"type": "synonym_comparison", "version": 1, **comparison.model_dump()}
