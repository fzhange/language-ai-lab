"""highlight-buddy 的一次性任务图谱：复习出题、每周阅读报告。

与对话型图谱不同，这些是单节点 prompt -> model -> text 图谱，
客户端通过无状态 `POST /runs/wait` 调用。
"""

from pathlib import Path

from langchain_core.messages import SystemMessage
from langgraph.graph import END, START, MessagesState, StateGraph

from core.model import get_chat_model
from core.tracing import HIGHLIGHT_BUDDY, with_trace_tags

_MODEL = get_chat_model()
_PROMPTS = Path(__file__).parent / "prompts"


def _make_one_shot_graph(prompt_file: str, name: str):
    system_prompt = (_PROMPTS / prompt_file).read_text(encoding="utf-8")

    async def generate(state: MessagesState):
        response = await _MODEL.ainvoke([SystemMessage(content=system_prompt), *state["messages"]])
        return {"messages": [response]}

    graph = StateGraph(MessagesState)
    graph.add_node("generate", generate)
    graph.add_edge(START, "generate")
    graph.add_edge("generate", END)
    # 方案 B：本地所有 graph 共用一个 LangSmith 项目，用 tags/metadata 区分来源
    return with_trace_tags(graph.compile(name=name), HIGHLIGHT_BUDDY, graph_name=name)


def make_quiz_graph():
    """`./assistants/highlight_buddy/study.py:make_quiz_graph`"""
    return _make_one_shot_graph("quiz.md", "highlight-quiz")


def make_report_graph():
    """`./assistants/highlight_buddy/study.py:make_report_graph`"""
    return _make_one_shot_graph("report.md", "highlight-report")
