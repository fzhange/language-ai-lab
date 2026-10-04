# language-ai-lab 工作区总览（给 AI Agent 的上下文文档）

> 本文件面向 AI 编码 Agent（如 CodeBuddy）。阅读本文件可快速理解整个工作区的目标、各仓库职责与关联关系。每个仓库根目录还有自己的 `AGENTS.md`，深入某个仓库前请先读它。

## 目标

构建一套**英语学习 AI Agent 系统**：以自研语言学习笔记为知识库，以浏览器插件沉淀的用户高亮数据为个性化素材，通过 Agent 服务 + Web 应用为用户提供对话式语言导师、复习测验、写作批改等能力。

核心理念（源自 `nature-of-language`）：**"理解而非死记"（Understand, Don't Memorize）**，强调语言现象的底层逻辑推导。

## 仓库组成与关联

```
┌──────────────────────────┐         ┌─────────────────────────────┐
│  words-highlight-in-web  │         │      nature-of-language      │
│  Chrome 插件（数据生产端） │         │  MD 笔记（知识库内容源）      │
└───────────┬──────────────┘         └──────────────┬──────────────┘
            │ 高亮/笔记数据                          │ 只读知识检索
            ▼                                       ▼
      ┌─────────────┐                     ┌──────────────────────────┐
      │  Supabase   │ ◄── 服务端查询 ──── │   generic-agent-service   │
      │ (whw_*)     │                     │  Agent 中台（LangGraph    │
      └─────▲───────┘                     │  Server + deepagents）    │
            │                             └───────────▲──────────────┘
            │ 登录/直读高亮                            │ SSE / REST
            │                                         │
      ┌─────┴─────────────────────────────────────────┴───┐
      │        language-learning-web（React）               │
      │        Web 前端：对话 / 高亮管理 / 测验 / 写作批改   │
      └───────────────────────────────────────────────────┘
```

| 仓库 | 角色 | 职责 | 变更策略 |
|---|---|---|---|
| `generic-agent-service/` | **Agent 中台** | 所有 AI 能力的统一出口：对话导师、测验、报告、写作批改。插件式 `assistants/` 架构 | **本轮主要扩展对象** |
| `nature-of-language/` | **知识库内容源** | 40 篇语言学习 MD 笔记（语法/词汇/雅思），被 Agent 服务以只读方式检索 | **不改动**，仅被读取 |
| `words-highlight-in-web/` | **用户数据生产端** | Chrome 插件：网页高亮 + 笔记/心得，数据双向同步到 Supabase | **不改动**，仅消费其数据 |
| `language-learning-web/` | **用户前端** | React Web 应用，连 LangGraph Server + Supabase | 已建脚手架，测验/批改页待后端图谱 |

## 关键集成约定

1. **Agent 服务即 LangGraph Server**：HTTP 层是 LangGraph Server 原生 API（REST + SSE 流式），按 `langgraph.json` 中的 graph id 路由；前端用 `@langchain/react` 的 `useStream` 直连。
2. **用户身份与数据**：Supabase 项目为唯一用户数据源（表前缀 `whw_`），RLS 按 `user_id` 隔离。Agent 服务端查询时，`user_id` 必须来自 run 的 `config.configurable`（前端注入），**不可信对话文本中的 user_id**。
3. **知识库只读**：Agent 对 `nature-of-language` 仅做只读检索（自定义 tool），禁止在服务端使用可写的 Filesystem/Shell Backend。
4. **密钥管理**：所有密钥（模型、Supabase service role、MCP token）仅经环境变量注入，不入库。
5. **后端问题不绕行**：接口/数据问题由后端修，前端不做 workaround。

## 规划中的扩展（当前设计共识）

- 新 assistant：`language-mentor`（对话导师，工具 = 知识库检索 + Supabase 高亮查询）
- 新一次性图谱：`writing-coach`（雅思写作批改，TR/CC/LR/GRA 四维度，中文解释英文示范）、`vocab-quiz`（基于用户高亮出题）
- 新前端仓库：`language-learning-web`（Vite + React + TS + `@langchain/react` + Supabase Auth）
