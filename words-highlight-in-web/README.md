# Words Highlight in Web

一个 Chrome / Edge / Brave 扩展：在任意网页上**高亮单词或句子**，支持**多种背景色**。采用「本地缓存 + Supabase 云端同步」架构——登录 Supabase 账号后可在**多台设备间自动同步**，离线/未登录也能正常用（数据存本地），并支持**导入导出**备份，页面刷新后自动恢复。

## 功能

- 选中网页文字，弹出取色条，点击颜色即可高亮。内置 **15 种背景色**（黄 / 琥珀 / 橙 / 红 / 粉 / 玫红 / 紫 / 靛紫 / 蓝 / 天蓝 / 青 / 蓝绿 / 绿 / 黄绿 / 灰）。
- **笔记 + 心得**：给任意高亮块添加两类内容——**笔记**（针对原文的翻译、注释）和**心得**（对内容的概念理解、感悟）。带内容的高亮有虚线下划线，悬停浮出笔记与心得；编辑面板的点缀色跟随高亮颜色。
- **右键菜单**：选中文字右键 →「高亮所选内容」，可选「用上次的颜色」或任一颜色。
- **快捷键**：`Alt+H` 用上次的颜色直接高亮当前选区（Mac 上即 `Option+H`，macOS 的 Alt 就是 Option 键；可在 `chrome://extensions/shortcuts` 修改）。
- **删除高亮**：点击已高亮的文字弹出编辑条后，按 `Delete` / `Backspace` 键即可删除（焦点在笔记输入框时删除键正常编辑文字）。也可用全局快捷键 `Alt+Shift+H`（Mac 即 `Option+Shift+H`）删除正在编辑或鼠标悬停的高亮。
- 点击已有高亮可切换颜色、编辑笔记或删除。
- 使用 CSS Custom Highlight API 渲染，**不修改网页 DOM**，不破坏原页面。
- 通过文本锚点（exact + 上下文）在刷新、重新打开后恢复高亮。
- **多设备同步（Supabase）**：本地缓存 + 云端双向对齐，两台电脑登录同一 Supabase 账号即自动同步；本地变更即时推送，定时/启动/手动做双向 reconciliation；删除用软删除墓碑传播、离线删除防复活、云端墓碑 7 天自动物理清除。
- **弹窗**：查看本页高亮列表（含笔记）、跳转、删除。
- **管理页**：
  - 「所有高亮」全局视图，跨页面平铺所有高亮，点来源可跳回原页并自动定位。
  - 「按页面」视图，分组管理、删除整页高亮。
  - 按高亮原文或笔记内容**搜索过滤**。
  - **导入 / 导出 JSON**：一键备份或跨设备迁移，导入按 URL 归并、按 id 去重合并。

## 技术栈

基于 [WXT](https://wxt.dev) + TypeScript 构建。WXT 负责打包、manifest 生成、HMR 热更新，代码用 TypeScript 编写。

云端同步基于 [Supabase](https://supabase.com)（Auth 邮箱登录 + Postgres 行级安全 RLS），客户端用 `@supabase/supabase-js`。

## 云同步

- 本地缓存（`chrome.storage.local`）读写优先，离线/未登录可用；登录 Supabase 账号后自动同步到云端。
- 本地变更即时推送（upsert + 软删除）；定时（5 分钟）/启动/手动触发**双向全量对齐**（reconciliation）。
- 删除采用软删除墓碑，跨设备传播；本地删除清单防止离线删除被复活；云端墓碑超 7 天自动物理清除。
- 建表 SQL 见 `whw_highlights`（含 `note` / `insight` / `deleted_at` / `updated_at` 触发器），行级安全保证只能读写自己的数据。

## 目录结构

```
wxt.config.ts       WXT 配置（manifest、权限、图标、快捷键）
tsconfig.json
package.json
entrypoints/        扩展入口（WXT 约定目录）
  background.ts     后台 service worker：消息分发 + 右键菜单 + 快捷键 + 定时同步 + 数据迁移
  content.ts        内容脚本：选区高亮、笔记、交互
  popup/            工具栏弹窗（index.html + main.ts + style.css）
  options/          管理页（index.html + main.ts + style.css）
lib/                共享模块
  supabase.ts       Supabase 客户端、Auth、数据操作
  sync-store.ts     本地缓存 + 双向同步 reconciliation + 墓碑管理 + 旧数据迁移
  anchor.ts         文本锚点定位（跨刷新恢复高亮）
  colors.ts         配色（全工程共用）
  types.ts          数据模型与消息类型
  content.css       内容脚本样式（高亮色、工具条、笔记面板）
  globals.d.ts      新 API 类型声明（Highlight、caretRangeFromPoint）
public/icons/       扩展图标（原样复制到输出）
dist/chrome-mv3/    构建产物（在浏览器中加载此目录）
```

## 开发

```bash
npm install        # 安装依赖（首次）
npm run dev        # 开发模式：监听文件变化，自动重打包 + 热更新
npm run build      # 生产构建，输出到 dist/chrome-mv3
npm run zip        # 打包成可发布的 zip
npm run compile    # 仅做 TypeScript 类型检查，不打包
```

`npm run dev` 后改动代码会自动重新构建，无需每次手动点扩展刷新。

## 安装步骤

### 1. 构建扩展

```bash
npm install
npm run build
```

### 2. 加载扩展

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本项目的 **`dist/chrome-mv3/`** 目录。

加载完成即可使用，数据保存在浏览器本地。

## 使用

### 高亮
- **添加高亮**：在网页上选中文字 → 点击弹出工具条上的颜色圆点。
- **右键高亮**：选中文字 → 右键「高亮所选内容」→ 选颜色或「用上次的颜色」。
- **快捷键**：选中文字后按 `Alt+H`（Mac 上为 `Option+H`），用上次的颜色快速高亮。
- **删除高亮**：点击已高亮的文字弹出编辑条 → 按 `Delete` / `Backspace` 键删除（或点工具条上的「删除」）。
- **改色**：点击已高亮的文字 → 在工具条选新颜色。

### 笔记与心得
- 选中文字或点击已有高亮 → 工具条点「笔记」→ 面板有两个输入区：**笔记**（翻译、注释）和**心得**（理解、感悟）→ 分别填写后「保存」（或 `⌘/Ctrl + Enter`）。
- 带笔记或心得的高亮显示虚线下划线，鼠标悬停即浮出两类内容（分节展示）。

### 查看与管理
- **查看本页**：点击浏览器工具栏的扩展图标，列表含每条高亮及其笔记、心得。
- **管理全部**：弹窗里点「管理全部」进入管理页。
  - 「所有高亮」/「按页面」两种视图切换。
  - 顶部搜索框按原文或笔记过滤。
  - 全局视图点「来源」跳回原页并自动滚动定位。
- **导出**：管理页点「导出 JSON」下载全部数据（文件名带日期）。
- **导入**：管理页点「导入」选择之前导出的 JSON，按 URL 归并、按 id 去重合并到现有数据。

## 说明与限制

- 需要 Chrome 105+（CSS Custom Highlight API）。
- 浏览器内置页面（如 `chrome://`）无法注入脚本，属正常现象。
- 页面正文若发生较大改动，个别高亮可能无法恢复（锚点失效）。
- 多设备同步需在管理页登录同一 Supabase 账号；未登录时数据只存本机。
- 本地删除是软删除（Supabase 后台行保留但 `deleted_at` 有时间戳），7 天后自动物理清除。
- 卸载扩展或清除浏览器数据会删除本地副本；已同步到云端的数据在重新登录后可拉回，重要数据仍建议定期「导出 JSON」。
