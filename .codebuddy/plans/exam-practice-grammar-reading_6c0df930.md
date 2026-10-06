---
name: exam-practice-grammar-reading
overview: 为英语学习站点规划独立的电脑端选择题练习：雅思、四六级、高中、初中四个 Tab 下覆盖语法和阅读理解，区分 AI 仿真原创题与可核实合法使用的真实原题。先核查原题来源与授权，再设计 Agent 出题、题库读取、答题批改和前端交互；无可用授权时绝不冒称真题。
design:
  architecture:
    framework: react
    component: shadcn
  styleKeywords:
    - 现有蓝色主题
    - 桌面双栏阅读
    - 清晰的来源标识
    - 克制的微动效
  fontSystem:
    fontFamily: Helvetica Neue, Inter, sans-serif
    heading:
      size: 28px
      weight: 700
    subheading:
      size: 18px
      weight: 600
    body:
      size: 15px
      weight: 400
  colorSystem:
    primary:
      - "#365CF2"
      - "#2646BD"
    background:
      - "#FAFAFC"
      - "#FFFFFF"
    text:
      - "#20232B"
      - "#626978"
    functional:
      - "#167A53"
      - "#C43D46"
      - "#A76617"
todos:
  - id: verify-content-rights
    content: 用 [skill:brainstorming] 核对授权范围，在 generic-agent-service/docs/exam-question-rights.md 记录可导入来源。
    status: completed
  - id: build-exam-service
    content: 用 [mcp:augment-context-engine] 核对调用链，新增 exam_http.py、exam_practice.py 与安全的出题评分契约。
    status: completed
    dependencies:
      - verify-content-rights
  - id: integrate-licensed-bank
    content: 实现 exam_catalog.py 与授权题库清单；无合规原题时返回明确空状态。
    status: completed
    dependencies:
      - build-exam-service
  - id: deliver-practice-ui
    content: 新增 ExamPracticePage.tsx 和 ExamQuestion.tsx，接入 App.tsx 独立导航及点选答题流程。
    status: completed
    dependencies:
      - build-exam-service
      - integrate-licensed-bank
  - id: verify-exam-flow
    content: 补齐前后端测试，验证来源标识、授权门槛、评分安全、异常状态及原有测验不受影响。
    status: completed
    dependencies:
      - deliver-practice-ui
---

## User Requirements

- 在现有“复习测验”之外增加独立练习，不改变基于用户高亮的测验流程。
- 以适合电脑操作的选择题为主，覆盖语法和阅读理解；阅读练习由文章和配套题目组成。
- 以“雅思、四六级、高中、初中”四个 Tab 区分练习范围，并明确区分“真实原题”和“AI 仿真原创题”。
- 用户点选答案并交卷后，查看得分、正确选项和中文解析。

## Product Overview

新增一个独立的桌面端练习页面：先选择考试范围、考察点和题目来源，再进入答题与结果查看。真实原题须先核实站内展示和使用权限；没有合规题目时展示明确的空状态，不以仿真题冒充真题。

## Core Features

- 四类考试范围切换，以及语法、阅读理解和题目来源选择。
- 分题点选、交卷评分与逐题解析；阅读文章和题目在桌面端便于对照。
- 真题展示出处和来源信息；仿真题明确标识为原创练习。

## Tech Stack Selection

沿用现有 Vite、React、TypeScript、Tailwind CSS 和页面组件；服务端沿用 Python、LangGraph Server、自定义挂载的 FastAPI 应用及 `core/model.py`。不新建独立服务，不改现有 `vocab-quiz` 或插件使用的 `highlight-*` 接口。

## Implementation Approach

推荐“**统一答题界面、双来源供题、服务端评分**”：新增练习接口负责读取已获许可的题库或生成仿真题，两种来源返回相同的公开题目结构。交卷由服务端按标准答案确定性评分，不再让模型临场决定对错。相比复用现有 Markdown 测验，这能支持可靠的点选交互和来源标识；相比立即采购第三方题库，不会把首版交付绑定到尚未确定的授权合同。

**先处理内容依赖**：调研雅思、四六级及初高中试题的权利人、授权条款、可展示范围、答案和出处，逐来源留存核查记录。雅思官方练习页及四六级官网仅作为候选线索；“公开可访问”不视为允许本站转载。只有取得可核实的站内使用依据，才导入对应原题；否则真题模式保留可用入口和空状态。雅思语法练习可提供仿真题，不标为“官方语法真题”。

## Architecture Design

- **HTTP 边界**：利用现有 `notes_http.py` 挂载方式增加独立练习路由，校验登录凭证、考试范围、题型及请求大小；复用前端现有服务地址配置。
- **供题**：后端按考试范围、考点和来源分流。真题仅从服务端许可题库读取；仿真题调用现有模型工厂，要求固定结构，并校验选项、答案、题号及阅读文章关联。生成不合格时有限次重试，仍失败则明确报错。
- **答题契约**：公开题目包含题目 ID、选项、来源标识及适用的文章和出处，不包含标准答案。服务端以短期有效、经认证加密且绑定用户的练习凭据保存判分信息；交卷提交该凭据及所选选项，返回逐题结果。首版不落库存储成绩，也不承诺跨设备续答。
- **安全与可靠性**：后端验证会话，不采信客户端传来的用户 ID、正确答案或“真题”声明；密钥仅由环境变量提供。限制生成题量、文章长度和模型调用次数；为请求设置超时与访问频率限制。错误日志不记录作文、试题全文、JWT 或完整练习凭据。生产环境继续通过鉴权网关访问服务，不直接公开 LangGraph Server。
- **性能**：题库按已验证的元数据建立服务端索引，筛选随候选题数线性增长；交卷按题数线性评分，不调用模型。仿真生成是主要延迟来源，仅在用户请求新题时调用，不因切换选项重复生成。

## Implementation Notes

先确认题库许可范围，再决定可上线的真题分类。前端对缺题、生成失败、凭据过期和未登录分别给出可恢复提示，不用前端数据转换掩盖后端契约错误。通过固定数量的练习题、结构校验及隔离的新路由控制模型成本和改动范围。

## Directory Structure Summary

以下为计划新增或修改的文件；已存在的 `/quiz` 页面、`runOnce` 和 `vocab-quiz` 图谱保持不变。

- `language-learning-web/src/App.tsx` **[MODIFY]**：增加独立练习导航与路由，保留现有主导航行为。
- `language-learning-web/src/pages/ExamPracticePage.tsx` **[NEW]**：承载四个 Tab、来源与考点筛选、答题阶段、阅读布局及结果状态；防止重复提交。
- `language-learning-web/src/components/exam/ExamQuestion.tsx` **[NEW]**：复用单题选项与交卷后解析呈现，保证键盘操作和清晰的选中状态。
- `language-learning-web/src/lib/exam.ts` **[NEW]**：集中定义前端题目契约和请求方法；携带会话凭证，统一处理接口错误。
- `language-learning-web/src/pages/ExamPracticePage.test.tsx` **[NEW]**：覆盖筛选、选项、交卷、缺题及失败状态。
- `language-learning-web/package.json`、`language-learning-web/package-lock.json` **[MODIFY]**：增加页面测试所需开发依赖与测试命令；不增加运行时 UI 框架。
- `generic-agent-service/notes_http.py` **[MODIFY]**：在现有挂载应用中接入独立练习路由，不改笔记接口。
- `generic-agent-service/exam_http.py` **[NEW]**：定义出题、交卷请求及响应边界，执行身份校验与输入限制。
- `generic-agent-service/assistants/language_mentor/exam_practice.py` **[NEW]**：生成仿真题、校验题目、封装私有判分信息并确定性评分。
- `generic-agent-service/assistants/language_mentor/exam_catalog.py` **[NEW]**：读取、校验并筛选已核实授权的真题内容；无题时返回明确结果。
- `generic-agent-service/assistants/language_mentor/prompts/exam_practice.md` **[NEW]**：约束四类考试范围的原创选择题及阅读文章生成，禁止声称为历年原题。
- `generic-agent-service/assistants/language_mentor/exam_content/manifest.json` **[NEW]**：初始为空的题库清单；后续仅登记许可、出处、答案齐全的内容。
- `generic-agent-service/docs/exam-question-rights.md` **[NEW]**：记录候选来源、核查证据、可使用范围与是否获准导入；不把未授权试题正文写入仓库。
- `generic-agent-service/tests/test_exam_practice.py` **[NEW]**：验证题目结构、授权门槛、答案不提前暴露、评分和凭据失效。
- `generic-agent-service/pyproject.toml`、`generic-agent-service/uv.lock` **[MODIFY]**：加入练习凭据加密所需依赖并保持锁文件一致。
- `generic-agent-service/README.md` **[MODIFY]**：说明新增接口、服务端密钥配置及真题导入前置条件。

## 页面设计

沿用站点现有侧边导航、顶部标题栏和卡片组件，以现有蓝色主题构建更聚焦的桌面答题区；不另起一套视觉系统。桌面端突出文章与选项的并排对照，小屏时顺序排列，保留可见的交卷操作。

### 练习与答题

1. **顶部导航**：沿用站点标题栏，标明“专项练习”和当前考试范围。
2. **考试 Tab**：雅思、四六级、高中、初中四项横向排列；切换时清楚显示当前选择。
3. **练习设置**：语法／阅读理解、真题／仿真题分组选择；用标签解释来源，不混用名称。
4. **答题主体**：语法题按题排列；阅读题采用左侧文章、右侧题目与选项，突出当前选项。
5. **底部操作栏**：显示已答数量和交卷按钮；无授权真题、加载失败时在主体区显示明确提示。

### 交卷结果

1. **顶部导航**：保留原考试与来源标识。
2. **成绩摘要**：以醒目的分数卡和答题数量概览结果。
3. **逐题反馈**：区分用户选择与正确选项，展开中文解析；阅读文章仍可对照。
4. **复习提示**：集中列出本次未掌握的考点，不伪称长期学习画像。
5. **底部操作栏**：提供返回设置和重新出题入口。

交互采用轻量的选项悬停、选中及结果展开过渡；错误与正确状态同时使用文字和图标语义，不仅依靠颜色。

# Agent Extensions

- **brainstorming**（Skill）：已用于明确独立练习、四个考试 Tab 和双来源边界；实施时以确认过的范围核对授权门槛和验收条件。预期结果是不将仿真题误称真题。
- **augment-context-engine**（MCP）：实施前核对新增路由与现有认证、页面和模型调用链。预期结果是改动落在现有扩展点，不破坏高亮测验或插件接口。