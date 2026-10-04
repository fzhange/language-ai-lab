"""Tracing 归属约定（方案 B）：本地所有 graph 共用一个 LangSmith 项目
（.env 里的 LANGSMITH_PROJECT），用 tags/metadata 区分 trace 来源。

新增 assistant 时：在这里加一个常量，图谱工厂里用 with_trace_tags() 打标。
"""

from collections.abc import Sequence
from typing import Any

# ---- 各来源的标识常量（所有引用处统一从这里取，禁止散落硬编码） ----
HIGHLIGHT_BUDDY = "highlight-buddy"
LANGUAGE_MENTOR = "language-mentor"
BACKENDS_DEMO = "backends-demo"


def make_trace_tags(assistant: str, graph_name: str | None = None) -> tuple[list[str], dict[str, Any]]:
    """生成统一的 tags/metadata。graph_name 与 assistant 同名时省略，避免重复。"""
    tags = [assistant]
    metadata: dict[str, Any] = {"assistant": assistant}
    if graph_name and graph_name != assistant:
        tags.append(graph_name)
        metadata["graph"] = graph_name
    return tags, metadata


def with_trace_tags(graph: Any, assistant: str, graph_name: str | None = None) -> Any:
    """给编译后的 graph 烘焙 tags/metadata（with_config 在每次 invoke 时自动合并）。

    用法：图谱工厂 return 之前包一层，例如
        return with_trace_tags(graph, HIGHLIGHT_BUDDY)
        return with_trace_tags(graph.compile(name=name), HIGHLIGHT_BUDDY, graph_name=name)
    """
    tags, metadata = make_trace_tags(assistant, graph_name)
    return graph.with_config(tags=tags, metadata=metadata)


def tagged_config(config: dict[str, Any], assistant: str) -> dict[str, Any]:
    """给直接调用 agent.invoke(config=...) 的脚本场景合并 tags。"""
    tags, _ = make_trace_tags(assistant)
    existing: Sequence[str] = config.get("tags") or []
    return {**config, "tags": [*existing, *tags]}
