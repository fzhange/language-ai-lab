# language-learning-web

英语学习系统的 Web 前端：与语言导师 AI 对话、管理浏览器插件沉淀的高亮数据、复习测验与写作批改（后两者待后端图谱就绪后接入）。

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 Supabase anon key（与 Words Highlight 插件同一项目）
npm run dev
```

前置依赖：`generic-agent-service` 已在本机启动（`uv run langgraph dev`，默认 `http://localhost:2024`）。

## 技术栈

Vite + React 19 + TypeScript + Tailwind CSS v4 + `@langchain/react`（useStream）+ Supabase。

更多架构与开发约定见 [AGENTS.md](./AGENTS.md) 与工作区总览 `../AGENTS.md`。
