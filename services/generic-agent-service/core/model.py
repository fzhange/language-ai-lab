"""Shared chat model factory for all graphs in this service."""

import os

from langchain.chat_models import init_chat_model
from langchain_core.language_models.chat_models import BaseChatModel

# 默认模型；在 .env 里设 CHAT_MODEL 可切换（格式 "openai:<模型名>"）
DEFAULT_MODEL = "openai:gpt-5.6-terra"


def get_chat_model(model: str | None = None) -> BaseChatModel:
    # CodeBuddy 代理只实现了 chat completions，必须关闭 Responses API
    kwargs: dict = {"use_responses_api": False}
    # 逃生开关：代理流式传输不稳定时（如 tool call 分块丢 name 导致空工具名），
    # 设 CHAT_DISABLE_STREAMING=1 让模型节点走非流式调用，牺牲逐 token 效果换稳定性
    if os.environ.get("CHAT_DISABLE_STREAMING") == "1":
        kwargs["disable_streaming"] = True
    name = model or os.environ.get("CHAT_MODEL", DEFAULT_MODEL)
    return init_chat_model(name, **kwargs)


def translation_model_name() -> str | None:
    # 纯字面翻译是轻任务：用更快的模型显著降低首字延迟（TTFT），
    # 让译文几乎即时出现，教学解释再由主模型流式补上。
    # 未设 TRANSLATE_MODEL 时返回 None，回退到主模型，行为与之前一致。
    return os.environ.get("TRANSLATE_MODEL") or None
