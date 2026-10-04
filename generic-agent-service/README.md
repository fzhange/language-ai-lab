# generic-agent-service

一个可插拔的 **Agent 中台**：一套基础设施（模型、注册发现、工具）承载多个
Assistant。基于 [`deepagents`](https://github.com/langchain-ai/deepagents) +
LangGraph 构建，可自部署（如 TKE）。

当前插件：`highlight-buddy`（Words Highlight in Web 扩展的 AI 后端）、
`language-mentor`（英语学习导师）。

**设计文档见 [`docs/platform-design.md`](docs/platform-design.md)**——分层结构、
插件约定（META + register）、路由方式、存储分工与技术栈，新增 Assistant 前必读。

## Architecture

```text
langgraph dev  ← LangGraph CLI 的子命令
    │
    ▼
LangGraph Server（API 服务，默认端口 2024）
    │  读 langgraph.json 路由表 → 按 graph id 加载 assistants/<name>/ 下的图谱工厂
    ▼
CompiledStateGraph（LangGraph 编译出的图：节点/边/状态机）
    │  对话型图谱内部
    ▼
create_deep_agent（deepagents 库）
    │  底层用的是
    ▼
LangChain（ChatOpenAI、中间件、工具抽象）
```

## Project structure

```text
core/               # 中台层：模型工厂、通用工具
assistants/         # 插件层：一个 Assistant = 一个自包含的包
  highlight_buddy/  #   阅读助手（agent.py 对话图谱 + study.py 一次性图谱 + prompts/ + tools/）
  language_mentor/  #   语言学习导师（agent.py 对话图谱 + prompts/ + tools/）
langgraph.json      # 路由表：graph id → 图谱工厂路径
examples/           # 可运行示例（如 thread 持久化验证）
.env                # API keys (never commit)
```

## Install

```bash
uv sync
```

## Develop

```bash
uv run langgraph dev
```

Then open LangGraph Studio at https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024
(or the URL printed by the dev server).

Checkpointer/store are injected by the LangGraph server: in-memory locally,
Postgres in production — no extra wiring in `agent.py`.

## Model

模型在 `.env` 里通过 `CHAT_MODEL` 切换（CodeBuddy 代理的内置模型均可，
格式 `openai:<模型名>`），不写则默认 `openai:gpt-5.6-terra`：

```bash
# .env
CHAT_MODEL=openai:gpt-5.6-terra
```

接入走 OpenAI 兼容代理（`OPENAI_BASE_URL` / `OPENAI_API_KEY`）。代理只实现
chat completions，所以 `core/model.py` 固定 `use_responses_api=False`——
deepagents 对 `openai:*` 模型默认走 Responses API，不加这个会 404。

## Self-host (TKE)

```bash
langgraph build -t <tcr-registry>/agent-service:latest
```

Deploy the image with:

- **Postgres** — checkpointer + store (thread state, cross-session persistence)
- **Redis** — task queue
- env secrets from `.env` (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, ...)

Notes:

- `OPENAI_BASE_URL=http://127.0.0.1:15721/...` is a local loopback proxy and is
  NOT reachable from a TKE pod — replace with a cluster-reachable address.
