"""A2A 门面层：自注册(Agent Card 发现) + JSON-RPC 调用桥接。

集中在本包内，避免散落在仓库根目录。对外只暴露 FastAPI ``router``，由
``http_api/`` 的 app 挂到 LangGraph Server 的自定义 HTTP app。
"""

from a2a_server.http import router

__all__ = ["router"]
