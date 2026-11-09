"""LangGraph Server 自定义 HTTP app 的装配入口。

在 ``langgraph.json`` 中通过 ``http.app`` 挂载（``./http_api/app.py:app``）。
把本中台的各组路由集中到一个包 ``http_api/`` 里，避免散落在仓库根目录：

- notes    笔记库只读接口
- exam     专项练习
- artifacts Markdown 产物下载
- chat     对话回复/轮次删除
- a2a      A2A 自注册(发现) + JSON-RPC 调用桥接
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from a2a_server import router as a2a_router
from http_api.chat import router as chat_router
from http_api.exam import router as exam_router
from http_api.markdown import router as markdown_router
from http_api.notes import router as notes_router

app = FastAPI(title="nature-of-language notes API", docs_url=None, redoc_url=None)
app.include_router(exam_router)
app.include_router(markdown_router)
app.include_router(chat_router)
app.include_router(a2a_router)
app.include_router(notes_router)


@app.middleware("http")
async def limit_exam_body(request: Request, call_next):
    if request.url.path in {"/exam/papers", "/exam/grade"}:
        if request.headers.get("content-length", "").isdigit() and int(request.headers["content-length"]) > 20000:
            return JSONResponse({"detail": "练习请求过大"}, status_code=413)
        chunks = bytearray()
        async for chunk in request.stream():
            chunks.extend(chunk)
            if len(chunks) > 20000:
                return JSONResponse({"detail": "练习请求过大"}, status_code=413)
        request._body = bytes(chunks)
    return await call_next(request)
