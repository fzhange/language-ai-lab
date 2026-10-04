"""模型代理丢工具名时的自愈 middleware。

背景：OpenAI 兼容代理（底层 Anthropic）做流式格式翻译时，偶发把 tool_call 的
name 字段弄丢（id/args 完好），ToolNode 因此报 "is not a valid tool"。
本 middleware 在模型返回后按参数键集合匹配工具签名，把空名 tool_call 修复为
唯一匹配的工具；无法唯一确定时保持原样（ToolNode 报错后模型会重试）。

用法：图谱工厂里 create_deep_agent(..., middleware=[RepairToolCallsMiddleware(tools)])
"""

import logging
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage
from langchain_core.tools import BaseTool

logger = logging.getLogger(__name__)


class RepairToolCallsMiddleware(AgentMiddleware):
    """按参数签名修复空工具名的 tool_call（仅覆盖构造时传入的工具清单）。

    Args:
        tools: 参与签名匹配的工具清单。
        prefer: 多个工具签名同时匹配时的优先顺序（按工具名排序，靠前者胜出）。
            用于消歧，例如 {"query"} 同时命中 search_notes / search_highlights。
    """

    def __init__(self, tools: list[BaseTool], prefer: list[str] | None = None) -> None:
        super().__init__()
        self._tools = {t.name: t for t in tools}
        self._prefer = prefer or []

    def _infer_name(self, args: dict[str, Any]) -> str | None:
        """参数键集合满足 required ⊆ keys ⊆ properties 的工具；歧义时按 prefer 消歧。"""
        keys = set(args)
        candidates = []
        for name, tool in self._tools.items():
            schema = getattr(tool, "args_schema", None)
            if schema is None:
                if not keys:
                    candidates.append(name)
                continue
            js = schema.model_json_schema()
            props = set(js.get("properties", {}))
            required = set(js.get("required", []))
            if required <= keys <= props:
                candidates.append(name)
        if len(candidates) == 1:
            return candidates[0]
        for favored in self._prefer:
            if favored in candidates:
                return favored
        return None

    def after_model(self, state: dict[str, Any], runtime: Any) -> dict[str, Any] | None:
        messages = state.get("messages") or []
        if not messages:
            return None
        last = messages[-1]
        if not isinstance(last, AIMessage):
            return None
        calls = last.tool_calls or []
        if not any(not c.get("name") for c in calls):
            return None

        fixed = []
        repaired = []
        for call in calls:
            if call.get("name"):
                fixed.append(call)
                continue
            name = self._infer_name(call.get("args") or {})
            if name is None:
                fixed.append(call)  # 无法唯一推断，保持原样走 ToolNode 报错重试
                continue
            repaired.append((call.get("id"), name))
            fixed.append({**call, "name": name})

        if not repaired:
            return None
        logger.warning("repair_tool_calls: 修复空工具名 %s", repaired)
        # 保持消息 id 不变，add_messages reducer 会原位替换
        return {"messages": [last.model_copy(update={"tool_calls": fixed})]}
