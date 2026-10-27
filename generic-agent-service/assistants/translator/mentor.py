"""Contextual translation mentor, streamed through native LangGraph SSE."""

from pathlib import Path
from typing import Literal, TypedDict

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, ConfigDict, Field, model_validator

from assistants.translator.agent import TranslationRequest, _text_of
from core.model import get_chat_model
from core.tracing import TRANSLATOR, with_trace_tags


class ConversationMessage(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=40_000)

    @model_validator(mode="after")
    def validate_content(self):
        if not self.content.strip():
            raise ValueError("Conversation messages must not be blank")
        return self


class MentorInput(TranslationRequest):
    focus: str = Field(default="", max_length=200)
    follow_up: str = Field(default="", max_length=2000)
    history: list[ConversationMessage] = Field(default_factory=list, max_length=41)

    @model_validator(mode="after")
    def validate_focus(self):
        if self.focus.strip() and self.focus.strip().casefold() not in self.text.casefold():
            raise ValueError("The focus word or phrase must occur in the source text")
        if self.follow_up and not self.follow_up.strip():
            raise ValueError("The follow-up question must not be blank")
        if bool(self.history) != bool(self.follow_up.strip()):
            raise ValueError("Follow-up questions require the completed conversation history")
        if self.history:
            if len(self.history) % 2 != 1:
                raise ValueError("Conversation history must end with a completed mentor answer")
            for index, message in enumerate(self.history):
                expected = "assistant" if index % 2 == 0 else "user"
                if message.role != expected:
                    raise ValueError("Conversation history must alternate assistant and user messages")
            if sum(len(message.content) for message in self.history) > 120_000:
                raise ValueError("Conversation is too long; start a new conversation")
        return self


class MentorState(TypedDict):
    text: str
    source_language: str
    target_language: str
    focus: str
    follow_up: str
    history: list[dict]
    explanation: str


def make_translation_mentor_graph():
    prompts = Path(__file__).parent / "prompts"
    prompt = (prompts / "mentor.md").read_text(encoding="utf-8")
    teaching = {
        language: (prompts / f"mentor_{language}.md").read_text(encoding="utf-8")
        for language in ("en", "zh")
    }
    follow_up_prompt = (prompts / "follow_up.md").read_text(encoding="utf-8")
    languages = {"en": "English", "zh": "Simplified Chinese"}

    async def explain(state: MentorState, config: RunnableConfig):
        request = MentorInput.model_validate(state)
        messages = [
            SystemMessage(content=(
                f"{prompt}\n{follow_up_prompt if request.follow_up else teaching[request.source_language]}"
                f"\nSource language: {languages[request.source_language]}"
                f"\nTranslation target: {languages[request.target_language]}"
            )),
            HumanMessage(content=request.model_dump_json(include={"text", "focus"})),
        ]
        for message in request.history:
            message_type = AIMessage if message.role == "assistant" else HumanMessage
            messages.append(message_type(content=message.content))
        if request.follow_up:
            messages.append(HumanMessage(content=request.follow_up))
        # ainvoke inside a graph node emits model tokens via messages-tuple SSE.
        response = await get_chat_model().ainvoke(messages, config=config)
        explanation = _text_of(response.content)
        if not explanation:
            raise ValueError("The mentor model returned no text")
        return {"explanation": explanation}

    graph = StateGraph(MentorState, input_schema=MentorInput)
    graph.add_node("explain", explain)
    graph.add_edge(START, "explain")
    graph.add_edge("explain", END)
    # Context is supplied per request, never stored as persistent graph checkpoints.
    return with_trace_tags(graph.compile(name="translation-mentor", checkpointer=False), TRANSLATOR, "translation-mentor")
