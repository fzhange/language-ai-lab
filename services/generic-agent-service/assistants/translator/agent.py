"""Translation via the native LangGraph Server POST /runs/wait API."""

from pathlib import Path
from typing import Literal, TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.model import get_chat_model, translation_model_name
from core.tracing import TRANSLATOR, with_trace_tags

Language = Literal["en", "zh"]
MAX_TEXT_LENGTH = 10_000


class TranslationInput(TypedDict):
    text: str
    source_language: Language
    target_language: Language


class TranslationState(TranslationInput):
    translation: str


class TranslationRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    text: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    source_language: Language
    target_language: Language

    @model_validator(mode="after")
    def validate_request(self):
        if not self.text.strip():
            raise ValueError("Source text must not be blank")
        if self.source_language == self.target_language:
            raise ValueError("Source and target languages must differ")
        return self


def _text_of(content: object) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "".join(
            block["text"] for block in content
            if isinstance(block, dict) and block.get("type") == "text"
            and isinstance(block.get("text"), str)
        ).strip()
    return ""


async def translate_request(request: TranslationRequest, config: RunnableConfig) -> str:
    prompt = (Path(__file__).parent / "prompts" / "translate.md").read_text(encoding="utf-8")
    languages = {"en": "English", "zh": "Simplified Chinese"}
    # 字面翻译走轻量快模型（TRANSLATE_MODEL），首字延迟更低；教学解释仍由主模型负责。
    response = await get_chat_model(translation_model_name()).ainvoke([
        SystemMessage(content=(
            f"{prompt}\nSource language: {languages[request.source_language]}"
            f"\nTarget language: {languages[request.target_language]}"
        )),
        HumanMessage(content=request.text),
    ], config=config)
    translation = _text_of(response.content)
    if not translation:
        raise ValueError("The translation model returned no text")
    return translation


def make_translation_graph():

    async def translate(state: TranslationState, config: RunnableConfig):
        request = TranslationRequest.model_validate(state)
        # Construct the model lazily: invalid input never makes a model request.
        return {"translation": await translate_request(request, config)}

    graph = StateGraph(TranslationState, input_schema=TranslationInput)
    graph.add_node("translate", translate)
    graph.add_edge(START, "translate")
    graph.add_edge("translate", END)
    return with_trace_tags(graph.compile(name=TRANSLATOR), TRANSLATOR)
