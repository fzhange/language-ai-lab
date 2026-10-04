"""language-mentor 的一次性任务图谱：写作批改、复习测验。

与对话型图谱不同，这些是单节点 prompt -> model -> text 图谱（vocab-quiz
多一个取数节点），客户端通过无状态 `POST /runs/wait` 调用。
"""

from pathlib import Path

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.graph.state import CompiledStateGraph

from assistants.language_mentor.tools.highlights import fetch_highlights
from core.model import get_chat_model
from core.tracing import LANGUAGE_MENTOR, with_trace_tags

_MODEL = get_chat_model()
_PROMPTS = Path(__file__).parent / "prompts"


def _make_one_shot_graph(prompt_file: str, name: str) -> CompiledStateGraph:
    system_prompt = (_PROMPTS / prompt_file).read_text(encoding="utf-8")

    async def generate(state: MessagesState):
        response = await _MODEL.ainvoke([SystemMessage(content=system_prompt), *state["messages"]])
        return {"messages": [response]}

    graph = StateGraph(MessagesState)
    graph.add_node("generate", generate)
    graph.add_edge(START, "generate")
    graph.add_edge("generate", END)
    # 方案 B：本地所有 graph 共用一个 LangSmith 项目，用 tags/metadata 区分来源
    return with_trace_tags(graph.compile(name=name), LANGUAGE_MENTOR, graph_name=name)


def make_writing_coach_graph():
    """`./assistants/language_mentor/study.py:make_writing_coach_graph`"""
    return _make_one_shot_graph("writing_coach.md", "writing-coach")


# ---- vocab-quiz：先取用户高亮，再出题/批改 ----


class _QuizState(MessagesState):
    highlights: str  # fetch 节点写入：格式化的高亮数据或错误说明
    ok: bool


async def _fetch(state: _QuizState, config: RunnableConfig):
    ok, text = await fetch_highlights(config, limit=20)
    return {"highlights": text, "ok": ok}


def _route(state: _QuizState) -> str:
    return "generate" if state["ok"] else "fallback"


async def _generate(state: _QuizState):
    system_prompt = (_PROMPTS / "vocab_quiz.md").read_text(encoding="utf-8")
    # 高亮数据作为上下文放在用户消息之前，保持对话历史（出题 -> 答题 -> 批改）完整
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=f"【用户高亮数据】\n{state['highlights']}"),
        *state["messages"],
    ]
    response = await _MODEL.ainvoke(messages)
    return {"messages": [response]}


async def _fallback(state: _QuizState):
    # 取数失败时直接面向用户给出友好提示（附技术原因便于排查）
    text = (
        "暂时无法读取你的高亮数据，没法为你个性化出题。\n\n"
        "请确认：① 已在网页右上角登录（与浏览器插件同一账号）；"
        "② 已用 Words Highlight 插件在网页上划过一些内容。\n\n"
        f"（技术原因：{state['highlights']}）"
    )
    return {"messages": [AIMessage(content=text)]}


def make_vocab_quiz_graph():
    """`./assistants/language_mentor/study.py:make_vocab_quiz_graph`"""
    graph = StateGraph(_QuizState)
    graph.add_node("fetch", _fetch)
    graph.add_node("generate", _generate)
    graph.add_node("fallback", _fallback)
    graph.add_edge(START, "fetch")
    graph.add_conditional_edges("fetch", _route)
    graph.add_edge("generate", END)
    graph.add_edge("fallback", END)
    # 方案 B：本地所有 graph 共用一个 LangSmith 项目，用 tags/metadata 区分来源
    return with_trace_tags(graph.compile(name="vocab-quiz"), LANGUAGE_MENTOR, graph_name="vocab-quiz")
