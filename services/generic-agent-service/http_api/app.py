"""LangGraph Server 自定义 HTTP app 的装配入口。

在 ``langgraph.json`` 中通过 ``http.app`` 挂载（``./http_api/app.py:app``）。
把本中台的各组路由集中到一个包 ``http_api/`` 里，避免散落在仓库根目录：

- notes    笔记库只读接口
"""

from fastapi import FastAPI

from http_api.notes import router as notes_router

app = FastAPI(title="nature-of-language notes API", docs_url=None, redoc_url=None)
app.include_router(notes_router)
