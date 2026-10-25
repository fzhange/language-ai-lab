"""Validate model-produced sentence structure before publishing a UI tool message."""

from typing import Literal

from langchain.tools import tool
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


Role = Literal["subject", "predicate", "object", "predicative", "complement",
               "attributive", "adverbial", "connective", "clause", "other"]


class Segment(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    text: str = Field(min_length=1, max_length=500)
    role: Role
    attaches_to: int | None = None
    reason: str = Field(min_length=1, max_length=300)


class ExplanationStep(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    kind: Literal["backbone", "modifier", "pitfall"]
    text: str = Field(min_length=1, max_length=500)


class SentenceStructure(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    sentence: str = Field(min_length=1, max_length=1600)
    summary: str = Field(min_length=1, max_length=600)
    segments: list[Segment] = Field(min_length=1, max_length=48)
    explanation_steps: list[ExplanationStep] = Field(default_factory=list, max_length=3)
    uncertainty: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_structure(self):
        if not self.sentence.strip() or not self.summary.strip():
            raise ValueError("Sentence and summary must not be blank")
        order = {"backbone": 0, "modifier": 1, "pitfall": 2}
        kinds = [order[step.kind] for step in self.explanation_steps]
        if kinds != sorted(set(kinds)) or any(not step.text.strip() for step in self.explanation_steps):
            raise ValueError("Explanation steps must be unique, ordered and nonblank")
        if "".join(segment.text for segment in self.segments) != self.sentence:
            raise ValueError("Segments must reconstruct the original sentence exactly")
        for index, segment in enumerate(self.segments):
            if not segment.reason.strip():
                raise ValueError("Every segment needs a reason")
            if segment.attaches_to is not None and (segment.attaches_to < 0 or segment.attaches_to >= len(self.segments) or segment.attaches_to == index):
                raise ValueError("Segment attachment must refer to another segment")
        for index, segment in enumerate(self.segments):
            seen = {index}
            parent = segment.attaches_to
            while parent is not None:
                if parent in seen:
                    raise ValueError("Segment attachments cannot form a cycle")
                seen.add(parent)
                parent = self.segments[parent].attaches_to
        return self


@tool
def present_sentence_structure(sentence: str, summary: str, segments: list[dict], uncertainty: str | None = None, explanation_steps: list[dict] | None = None) -> dict:
    """在导师对话里展示句子结构卡片。仅在用户选择「句子结构分析」模式时使用。

    Args:
        sentence: 原句；必须逐字保留用户输入的完整句子（含空格和标点）。
        summary: 一句简短中文点明句子主干和关键挂靠，尽量不超过 80 字；不要罗列所有标签。
        segments: 按原句顺序切分的片段；text 连起来必须恰好是原句（空格留在片段中）。每项给 role（subject/predicate/object/predicative/complement/attributive/adverbial/connective/clause/other）、attaches_to（所修饰片段的从零开始序号；没有则为 null）、reason（一句简短的中文判断依据）。不要强行把表语归为宾语。
        uncertainty: 仅有真实结构歧义时说明另一种读法及其语境；不能可靠判断时坦诚说明。无歧义则留空，不凭空创造可能性。
        explanation_steps: 展开区的有序要点，最多三项，按 backbone（句子主干）→ modifier（修饰与从句）→ pitfall（容易误判）排列。每项含 kind 和一句或两句中文 text；不适用的类型略去，不要复述 summary，也不要写成一大段。新分析尽量填写，旧数据可为空。
    """
    try:
        structure = SentenceStructure(sentence=sentence, summary=summary, segments=segments, uncertainty=uncertainty, explanation_steps=explanation_steps or [])
    except ValidationError:
        return {"error": "句子结构数据不一致；请核对原句、逐字切分、成分与挂靠关系，并重试或改用文字解释。"}
    return {"type": "sentence_structure", "version": 1, **structure.model_dump()}
