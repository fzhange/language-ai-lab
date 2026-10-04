# words-highlight-in-web — Chrome 高亮插件（给 AI Agent 的上下文文档）

> 先读工作区总览：`../AGENTS.md`。本仓库是**用户数据生产端**，当前阶段不改动，仅被系统其他部分消费数据。

## 目标与定位

Chrome MV3 插件：在任意网页划词高亮（不修改网页 DOM），记录笔记（note）与心得（insight），数据双向同步到 Supabase，并调用 Agent 服务做 AI 复习/报告/追问。用户的学习数据（高亮、心得、AI 会话）在这里沉淀，是系统个性化的数据基础。

## 技术栈

- WXT `^0.19` + TypeScript（无前端框架，原生 TS + DOM），构建产物 Chrome MV3
- `@supabase/supabase-js`（云端同步）、`marked` + `dompurify`（MD 渲染 + XSS 消毒）
- 快捷键 `Alt+H` / `Alt+Shift+H`，权限 `storage, activeTab, scripting, contextMenus, alarms, notifications`

## 核心结构

| 路径 | 作用 |
|---|---|
| `entrypoints/background.ts` | service worker：消息分发、右键菜单、定时同步、AI 代理、Supabase Auth |
| `entrypoints/content.ts` | 内容脚本：选区高亮、笔记面板 |
| `entrypoints/popup/` `entrypoints/options/` | 弹窗 / 管理页（全局视图、导入导出、AI 复习/报告/聊天/关联） |
| `lib/sync-store.ts` | **核心存储层**：本地缓存 + 云端双向 reconciliation |
| `lib/supabase.ts` | Supabase 客户端 + 数据访问（全量查询带 `user_id`，依赖 RLS） |
| `lib/ai.ts` | LangGraph Server AI 客户端（`/runs/wait`、`/threads/:id/runs/stream` SSE） |
| `lib/types.ts` | 数据模型 |
| `lib/anchor.ts` | TextQuote 锚点（exact+prefix+suffix，跨刷新恢复高亮） |

## 数据模型（其他仓库消费数据时必读）

单条高亮（`lib/types.ts`）：

```ts
interface HighlightItem {
  id: string; color: string;
  exact: string; prefix: string; suffix: string;  // 文本锚点
  note: string;      // 笔记：翻译、注释
  insight: string;   // 心得：理解、感悟
  title: string; createdAt: number; updatedAt?: number;
}
```

云端表（Supabase，RLS 按 `user_id` 隔离）：

- `whw_highlights`：`id / user_id / page_url / page_title / color / exact / prefix / suffix / note / insight / created_at / updated_at / deleted_at`（软删除墓碑）
- `whw_chat_messages`：`id / user_id / highlight_id / thread_id / role / content / created_at`（高亮追问的 AI 会话）

本地存储键（`chrome.storage.local`）：`whw:v2:page:<url哈希>`、`whw:v2:tombstones`、`whw:v2:lastPull`、`whw:v2:threads`（highlightId → LangGraph threadId）。

## 与其他仓库的关系

- **调用 `generic-agent-service`**：`lib/ai.ts` 连 LangGraph Server（默认 `http://localhost:2024`，可配 baseUrl + Bearer token），使用 graph id `highlight-buddy` / `highlight-quiz` / `highlight-report`——**Agent 服务改接口需保持兼容**
- **数据被消费**：Supabase `whw_*` 表将被 Agent 服务（导师工具）和规划中的 `language-learning-web` 前端读取；Schema 变更需三方同步
- **高亮内容可被 `nature-of-language` 知识库讲解**：Agent 结合笔记回答用户关于高亮句子的问题

## 注意

- Supabase URL / publishable key 目前硬编码于 `lib/supabase.ts`（anon key + RLS 属常规做法，如需收紧可移到配置）
- AI 渲染必须经 `dompurify` 消毒（防 XSS），新增渲染入口时遵守
