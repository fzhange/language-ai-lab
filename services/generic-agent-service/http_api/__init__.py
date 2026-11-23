"""本中台的自定义 HTTP 层（挂在 LangGraph Server 上）。

对外暴露装配好的 FastAPI ``app``，供 langgraph.json 的 ``http.app`` 使用，
也方便测试 ``from http_api import app``。
"""

from http_api.app import app

__all__ = ["app"]
