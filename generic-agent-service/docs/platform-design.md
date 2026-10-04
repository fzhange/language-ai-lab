# Agent 中台设计文档

> 面向人和 AI 的导读：本文说明 generic-agent-service 的定位、分层设计、插件约定与技术栈。
> 新增 Assistant 前必读；AI 在本仓库工作时请先读本文与 `assistants/__init__.py` 的目录约定。

## 1. 定位与方向

本服务是一个 **Agent 中台**：一套基础设施上承载多个互相独立的 Assistant（智能体）。
它不是任何一个具体 Assistant 的服务端——highlight-buddy 只是第一个插件。

设计目标：

1. **可插拔**：新增 Assistant = 新建一个目录，不改任何既有代码；
2. **共享复用**：模型、工具、注册发现等通用能力收敛在中台层；
3. **路由标准化**：对外通过统一的 graph id 路由到具体 Assistant 的图谱。

## 2. 分层结构

```text
generic-agent-service/
├── core/                     # 中台层：与具体 Assistant 无关（不得 import assistants/*）
│   ├── model.py              #   模型工厂（所有图谱共用一个 chat model 配置）
│   └── tools/                #   跨 Assistant 通用工具（至少两个 Assistant 需要才放这里）
│
├── assistants/               # 插件层：一个 Assistant = 一个自包含的包
│   ├── highlight_buddy/      #   网页高亮阅读助手（生产在用）
│   │   ├── __init__.py       #     包说明（文档用途）
│   │   ├── agent.py          #     对话图谱（deepagents，thread 持久化多轮）
│   │   ├── study.py          #     一次性任务图谱（quiz/report，无状态调用）
│   │   ├── prompts/          #     本 Assistant 的全部 prompt
│   │   └── tools/            #     本 Assistant 专属工具 / MCP 配置
│   └── language_mentor/      #   语言学习导师（对话型 deep agent）
│
├── langgraph.json            # 路由表：graph id → 图谱工厂路径（唯一的注册点）
├── examples/                 # 可运行的示例/验证脚本
└── docs/
```

依赖方向是单向的：`assistants/*` → `core/*`，**禁止反向**。

## 3. 插件约定（新增 Assistant 的规则）

中台刻意**不做**自动发现/动态注册——唯一的注册点是 `langgraph.json` 路由表，
看到路由表即看到全部对外能力，心智成本最低。

唯一的软性约定是**惰性原则**：图谱模块被 import 时不能有副作用
（不读必需的 env、不连外部服务），否则 Server 启动时所有图谱会被一起加载，
一个 Assistant 缺配置会拖垮整个服务。env/token 应在图谱工厂或工具函数内
惰性读取。

## 4. 路由与请求链路

LangGraph Server 原生以 `assistant_id`（= graph id）路由，无需自建网关：

```
客户端（浏览器扩展 / 其他应用）
  │  POST /threads/{tid}/runs/wait   {assistant_id: "highlight-buddy"}   ← 多轮对话
  │  POST /runs/wait                 {assistant_id: "highlight-quiz"}    ← 无状态任务
  ▼
LangGraph Server（按 langgraph.json 路由表加载并分发）
  ▼
assistants/<name>/ 的图谱工厂 → core/model.py 的模型 → LLM 代理
```

新增 Assistant 的完整步骤：

1. 建 `assistants/<name>/` 目录（照抄 highlight_buddy 的形状）；
2. 写图谱工厂函数（对话型参考 `agent.py`，一次性参考 `study.py`）；
3. 在 `langgraph.json` 的 `graphs` 里登记 graph id → 工厂路径；
4. `uv run langgraph dev` 起来后调一把自检。

## 5. 两类图谱形态

| 形态 | 适用 | 客户端调用 | 状态 |
|---|---|---|---|
| 对话型（deepagents） | 追问、多轮、需要工具 | `/threads/{tid}/runs/*` | thread 由 server checkpointer 持久化 |
| 一次性（单节点 StateGraph） | 出题、报告等单轮生成 | `/runs/wait` | 无状态 |

选择依据：需要"记住上文"就用对话型；纯函数式生成用一次性，省掉 thread 管理。

## 6. 会话与存储的分工（重要）

```
LangGraph thread（checkpointer）  = 模型上下文工作内存，可随时重建
Supabase whw_chat_messages 表     = 会话的持久真相（应用层落库，跨设备）
```

客户端（扩展）在每轮问答完成后把消息追加到 Supabase；LangGraph 侧的 thread
丢失/重建不影响用户数据。中台自身的 checkpointer 因而可以自由选择实现：

- 本地 dev：`langgraph dev`（inmem runtime + `.langgraph_api/` 落盘）
- 生产：`langgraph build` 出镜像 + Postgres（checkpointer/store）+ Redis（queue）

## 7. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 语言/包管理 | Python 3.13 + uv | `uv sync` / `uv run` |
| Agent 框架 | deepagents ≥0.7 | 对话型图谱（内置规划/子代理/文件系统中间件） |
| 图编排 | LangGraph | 一次性图谱用裸 `StateGraph`；server 注入 checkpointer |
| 模型接入 | langchain-openai | `openai:gpt-5.6-terra`，经 OpenAI 兼容代理 |
| 外部工具 | langchain-mcp-adapters | MCP server 按 Assistant 隔离配置 |
| 本地服务 | langgraph-cli[inmem] | `uv run langgraph dev`，默认端口 2024 |
| 客户端存储 | Supabase | 高亮数据 + 会话记录，anon key + RLS，无后端鉴权代码 |

模型注意：当前代理只实现 chat completions，`init_chat_model` 必须传
`use_responses_api=False`（否则 deepagents 默认走 Responses API 返回 404）。

## 8. 路线图

- [x] 插件化目录结构（core/ + assistants/）
- [ ] 中台横向能力：tracing 打标、用量统计、限流（需要时再引入注册表/网关）
- [ ] 生产部署：TKE + Postgres + Redis（见 README「Self-host」）
