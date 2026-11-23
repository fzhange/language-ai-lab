# language-ai-lab 工作区总览（给 AI Agent 的上下文文档）

> 本文件面向 AI 编码 Agent（如 CodeBuddy）。阅读本文件可快速理解整个工作区的目标、各仓库职责与关联关系。每个仓库根目录还有自己的 `AGENTS.md`，深入某个仓库前请先读它。

## 目标

构建一套**英语学习 AI Agent 系统**：以自研语言学习笔记为知识库，以浏览器插件沉淀的用户高亮数据为个性化素材，通过 Web 应用管理学习笔记、高亮与收藏，通过 Agent 服务为插件和翻译客户端提供 AI 能力。

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
      │        Web 前端：知识库笔记 / 高亮管理 / 收藏       │
      └───────────────────────────────────────────────────┘
```

| 仓库 | 角色 | 职责 | 变更策略 |
|---|---|---|---|
| `services/generic-agent-service/` | **Agent 中台** | 插件高亮助手、测验、报告、翻译与译文讲解。插件式 `assistants/` 架构 | 按功能扩展 |
| `docs/nature-of-language-knowledge-base/` | **知识库内容源** | 语言学习 MD 笔记（语法/词汇/雅思），由只读 HTTP 接口提供 | **不改动**，仅被读取 |
| `words-highlight-in-web/` | **用户数据生产端** | Chrome 插件：网页高亮 + 笔记/心得，数据双向同步到 Supabase | **不改动**，仅消费其数据 |
| `language-learning-web/` | **用户前端** | React Web 应用，连 LangGraph Server + Supabase | 已接入笔记、高亮与收藏 |
| `translate-app/` | **macOS 翻译客户端** | Electron + React，中英双向翻译，Command+B 全局唤醒，调用中台 `translator` 图谱 | 独立客户端，模型与密钥保留在 Agent 中台 |

## 关键集成约定

1. **Agent 服务即 LangGraph Server**：HTTP 层是 LangGraph Server 原生 API（REST + SSE 流式），按 `langgraph.json` 中的 graph id 路由；插件与翻译客户端调用对应图谱；Web 知识库使用只读 `/notes` 接口。
2. **用户身份与数据**：Supabase 项目为唯一用户数据源（表前缀 `whw_`），RLS 按 `user_id` 隔离。Agent 服务端查询时，`user_id` 必须来自 run 的 `config.configurable`（前端注入），**不可信对话文本中的 user_id**。
3. **知识库只读**：服务对 `docs/nature-of-language-knowledge-base` 仅提供只读访问，禁止在服务端使用可写的 Filesystem/Shell Backend。
4. **密钥管理**：所有密钥（模型、Supabase service role、MCP token）仅经环境变量注入，不入库。
5. **后端问题不绕行**：接口/数据问题由后端修，前端不做 workaround。

## 当前功能

- Web：知识库笔记、我的高亮、我的收藏与周总结。
- Agent 服务：浏览器高亮助手、插件测验与报告、翻译与译文讲解。
