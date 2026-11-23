# language-learning-web — 英语学习 Web 前端（给 AI Agent 的上下文文档）

> 先读工作区总览：`../AGENTS.md`。本仓库是系统的**用户前端**。

## 目标与定位

React Web 应用，阅读英语学习知识库，并整合浏览器插件沉淀的高亮、收藏与学习总结。

## 产品原则（所有 AI Agent 必须遵守）

本仓库的目标是**帮助用户学习和真正理解英语**，而不是构建一个通用聊天、笔记或内容管理产品。

核心原则：**“理解，而非死记”（Understand, Don't Memorize）**。

设计或实现任何功能、界面、文案与 AI 交互时：

1. 优先解释语言现象背后的含义、语境、规律和推导过程，而不是只给答案、翻译或要求记忆规则。
2. 用真实语境、对比、例句和可迁移的思考方式帮助用户形成理解；练习与复习应检验理解和运用能力，而不只是机械重复。
3. 鼓励用户记录自己的观察、总结和困惑，让高亮、收藏与笔记成为后续理解和反思的材料。
4. 新功能必须服务于英语学习目标。不要因为它适合通用 AI、笔记或效率工具就默认加入。
5. 保持反馈清晰、耐心且具体，既指出问题，也解释原因和改进方法，帮助用户逐步独立判断。

核心页面：

| 路由 | 页面 | 数据来源 | 状态 |
|---|---|---|---|
| `/notes` | 知识库笔记 | nature-of-language 内容 | 已接入 |
| `/highlights` | 我的高亮 | Supabase `whw_highlights`（插件同步的数据） | 已接入 |
| `/collections` | 我的收藏 | Supabase 用户收藏与周总结 | 已接入 |

## 技术栈

- Vite + React 19 + TypeScript + Tailwind CSS v4（`@tailwindcss/vite` 插件，`src/index.css` 只有一行 `@import 'tailwindcss'`）
- `@supabase/supabase-js`：邮箱密码 Auth + 读 `whw_highlights`（RLS 按 `user_id` 隔离）
- `react-router-dom` v7 路由、`react-markdown` 渲染知识库笔记与高亮注释

## 关键约定

1. **配置**：全部经 `VITE_*` 环境变量注入（见 `.env.example`），读取统一走 `src/lib/config.ts`，不散落 `import.meta.env`。
2. **用户数据**：通过 Supabase 会话访问高亮、收藏与周总结，RLS 按 `user_id` 隔离。
3. **认证**：`AuthGate`（`src/components/AuthGate.tsx`）——Supabase 配置齐全时要求登录（与插件同账号）；未配置时免登录，可阅读知识库。
4. **Markdown 渲染**：`react-markdown`。若未来引入 HTML 渲染，必须消毒（防 XSS）。
5. **后端问题不绕行**：接口/数据问题由 Agent 服务或 Supabase 侧修，前端不做兼容 workaround。
6. **CORS/部署**：本地开发直连 `http://localhost:2024`；生产环境需在网关层做鉴权代理，不把 LangGraph Server 直接暴露公网。

## 本地运行

```bash
npm install
cp .env.example .env   # 填入 Supabase anon key
npm run dev
```

前置：`services/generic-agent-service` 已启动（`uv run langgraph dev`，端口 2024）。

## 目录结构

```
src/
├── lib/         # config / supabase / auth（基础设施）
├── components/  # AuthGate
├── pages/       # NotesPage / HighlightsPage / CollectionsPage
├── App.tsx      # 侧边导航外壳 + 路由
└── main.tsx     # BrowserRouter + AuthProvider
```

## 与其他仓库的关系

- **依赖 `services/generic-agent-service`**：只读 `/notes` 接口（已接入）；首页 `/` 跳转 `/notes`。
- **依赖 `words-highlight-in-web` 的 Supabase 数据**：`whw_highlights` schema 见该仓库 `AGENTS.md`，schema 变更需同步本仓库 `src/lib/supabase.ts` 的 `HighlightRow`
- **知识库内容源**：`docs/nature-of-language-knowledge-base`，由后端只读接口提供。
