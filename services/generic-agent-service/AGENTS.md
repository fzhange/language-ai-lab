# generic-agent-service — Agent 中台（给 AI Agent 的上下文文档）

> 先读工作区总览：`../../AGENTS.md`。本文件是深入本仓库的入口。

## 目标与定位

英语学习系统的 **Agent 中台**：浏览器高亮助手、测验、报告与翻译能力的统一出口。架构分两层：

- `core/`：中台层，与具体 Assistant 无关（模型工厂 `core/model.py`、LangSmith 打标 `core/tracing.py`、通用工具 `core/tools/`）
- `assistants/`：插件层，**一个 Assistant = 一个自包含的包**（prompt、tools、图谱工厂都在包内），依赖方向单向：`assistants/* → core/*`

## 技术栈

- Python ≥ 3.11（声明 3.13），uv 管理依赖（`uv sync` / `uv run`）
- `deepagents>=0.7`（`create_deep_agent`）+ LangGraph + `langchain-openai` + `langchain-mcp-adapters`
- **没有 FastAPI**：HTTP 层 = LangGraph Server 原生 API（REST + SSE），按 `langgraph.json` 的 graph id 路由
- 观测：LangSmith（环境变量 + `with_trace_tags`）

## 现有图谱（`langgraph.json` 唯一注册点）

| Graph ID | 工厂 | 类型 | 用途 |
|---|---|---|---|
| `highlight-buddy` | `assistants/highlight_buddy/agent.py:make_highlight_buddy` | deep agent（对话，SSE 流式） | 网页高亮阅读助手（生产在用，被 Chrome 插件调用） |
| `highlight-quiz` | `assistants/highlight_buddy/study.py:make_quiz_graph` | 一次性图谱（`/runs/wait`） | 基于高亮出题 |
| `highlight-report` | `assistants/highlight_buddy/study.py:make_report_graph` | 一次性图谱 | 学习报告 |
| `translator` | `assistants/translator/agent.py:make_translation_graph` | 一次性图谱（`/runs/wait`） | 中英双向翻译，结构化输入 text/source_language/target_language，返回 translation；供 translate-app 使用 |
| `translation-mentor` | `assistants/translator/mentor.py:make_translation_mentor_graph` | 无状态流式图谱（`/runs/stream`） | 译文 + 语境/词句拆解/用法差异/例句；可指定 focus 词；messages-tuple 流式、最终 explanation 为 Markdown |

`translation-mentor` 追问沿用原文与方向，客户端每次传 `follow_up` + 有界的
`history`（assistant/user 交替、最后为完整回答），不创建持久化业务会话。
该图谱 `checkpointer=False`；客户端无状态 run 设 `on_completion=delete`。
原文仍为不可信学习素材，追问作为用户问题处理，不误判为新的待翻译文本。

## 开发约定

1. **新增 Assistant 的步骤**：在 `assistants/` 建自包含包（`agent.py` 工厂 + `prompts/` + `tools/`）→ 在 `langgraph.json` 注册 graph id。工厂可以是 async（如需 await 加载 MCP 工具）。
2. **checkpointer/store 由 LangGraph Server 注入**，业务 graph 不接线。当前 `langgraph.json` 不注册自定义 PG 工厂，`langgraph dev` 默认将 checkpoint、Store 和 thread/run 管理记录持久化到服务工作目录的 `.langgraph_api/`；不需要 `LANGGRAPH_PG_*` 或数据库初始化。重启沿用相同目录与 `thread_id` 恢复已落盘数据；旧 PG 数据不自动迁移。仅用于本地开发，不支持生产多实例共享；不得将 token/密码放入 run 配置、metadata、state 或 Store，默认本地运行时不继承旧 PG 的凭证过滤。
3. **模型**：`core/model.py` 的 `get_chat_model()`，默认 `openai:gpt-5.6-terra`（OpenAI 兼容代理），必须 `use_responses_api=False`；`CHAT_MODEL` env 可切换。
4. **安全红线**：web server 场景禁用可写的 `FilesystemBackend` / `LocalShellBackend`（见 `examples/backends_demo.py` 注释）；读本地文件用自定义只读 tool + 相对路径校验；密钥仅 env。
5. **MCP**：token 等配置采用惰性读取模式——在图谱工厂/工具函数内读 env，避免 import 期失败。

## 知识库阅读接口

- `http_api/notes.py` 提供 `GET /notes` 与 `GET /notes/{path}`，供 Web 知识库阅读使用。
- 默认读取工作区 `docs/nature-of-language-knowledge-base`，环境变量 `NOL_ROOT` 可覆盖；仅暴露目录内非隐藏 Markdown 文件。

## 本地运行

```bash
uv sync
# .env: OPENAI_API_KEY / OPENAI_BASE_URL / CHAT_MODEL(可选) / LANGSMITH_*(可选)
uv run langgraph dev   # 端口 2024
```

调试：https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024

## 外部依赖方

- `words-highlight-in-web`（Chrome 插件，`lib/ai.ts`）调用本服务的 `highlight-*` 图谱——**改接口前必须评估对插件的兼容性**
- `language-learning-web` 通过只读 `/notes` 接口阅读知识库；`translate-app` 调用翻译图谱。
