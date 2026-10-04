# generic-agent-service — Agent 中台（给 AI Agent 的上下文文档）

> 先读工作区总览：`../AGENTS.md`。本文件是深入本仓库的入口。

## 目标与定位

英语学习系统的 **Agent 中台**：所有 AI 能力（对话导师、测验、报告、写作批改）的统一出口。架构分两层：

- `core/`：中台层，与具体 Assistant 无关（模型工厂 `core/model.py`、LangSmith 打标 `core/tracing.py`、通用工具 `core/tools/`、自愈 middleware `core/middleware.py`）
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
| `language-mentor` | `assistants/language_mentor/agent.py:make_language_mentor` | deep agent（对话，SSE 流式） | 英语学习导师：知识库（nature-of-language）只读检索 + 用户高亮查询 + 语言讲解 |
| `writing-coach` | `assistants/language_mentor/study.py:make_writing_coach_graph` | 一次性图谱（`/runs/wait`） | 雅思写作批改（TR/CC/LR/GRA 四维度，中文解释英文示范） |
| `vocab-quiz` | `assistants/language_mentor/study.py:make_vocab_quiz_graph` | 一次性图谱（取数节点 + 生成节点） | 基于用户 Supabase 高亮出题/批改（同会话历史第二次调用进入批改模式） |

## 开发约定

1. **新增 Assistant 的步骤**：在 `assistants/` 建自包含包（`agent.py` 工厂 + `prompts/` + `tools/`）→ 在 `langgraph.json` 注册 graph id。工厂可以是 async（如需 await 加载 MCP 工具）。
2. **checkpointer/store 由 LangGraph Server 注入**，业务代码不接线。
3. **模型**：`core/model.py` 的 `get_chat_model()`，默认 `openai:gpt-5.6-terra`（OpenAI 兼容代理），必须 `use_responses_api=False`；`CHAT_MODEL` env 可切换。
4. **安全红线**：web server 场景禁用可写的 `FilesystemBackend` / `LocalShellBackend`（见 `backends_demo.py` 注释）；读本地文件用自定义只读 tool + 相对路径校验；密钥仅 env。
5. **MCP**：token 等配置采用惰性读取模式——在图谱工厂/工具函数内读 env，避免 import 期失败。
6. **代理丢工具名的自愈**：OpenAI 兼容代理（底层 Anthropic）流式翻译偶发丢失 tool_call 的 name（id/args 完好）。已在 `language-mentor` 接入 `RepairToolCallsMiddleware`（按参数签名修复空名工具调用）。若仍频繁失败，可在 `.env` 设 `CHAT_DISABLE_STREAMING=1` 彻底绕开流式分块合并（牺牲逐 token 效果）。新 assistant 若带本地工具，建议同样挂上该 middleware。

## 当前扩展方向

- 已落地：`language-mentor`（知识库 + 高亮工具）、`writing-coach`、`vocab-quiz`。
- Supabase 高亮访问采用**用户 JWT 透传**：前端把会话 token 放 `config.configurable.supabase_token`，服务端用 anon key + JWT 走 PostgREST，RLS 做授权，服务端不存 service key。env 需要 `SUPABASE_URL` / `SUPABASE_ANON_KEY`。
- 后续候选：学习报告（复用 `highlight-report`）、写作批改历史落库、测验结果沉淀。

## 本地运行

```bash
uv sync
# .env: OPENAI_API_KEY / OPENAI_BASE_URL / CHAT_MODEL(可选) / LANGSMITH_*(可选)
uv run langgraph dev   # 端口 2024
```

调试：https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024

## 外部依赖方

- `words-highlight-in-web`（Chrome 插件，`lib/ai.ts`）调用本服务的 `highlight-*` 图谱——**改接口前必须评估对插件的兼容性**
- 规划中的 `language-learning-web` 前端将通过 `@langchain/react` 的 `useStream` 直连本服务
