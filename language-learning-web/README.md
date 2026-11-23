# language-learning-web

英语学习系统的 Web 前端：阅读知识库笔记、管理浏览器插件沉淀的高亮与收藏。

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 Supabase anon key（与 Words Highlight 插件同一项目）
npm run dev
```

前置依赖：`services/generic-agent-service` 已在本机启动（`uv run langgraph dev`，默认 `http://localhost:2024`）。

## 技术栈

Vite + React 19 + TypeScript + Tailwind CSS v4+ Supabase。

更多架构与开发约定见 [AGENTS.md](./AGENTS.md) 与工作区总览 `../AGENTS.md`。

首页默认打开知识库笔记；高亮与收藏沿用浏览器插件的 Supabase 账号。
