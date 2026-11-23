# LangChain / LangGraph / Deep Agents 技术选型指南

三者是 LangChain 公司维护的**分层**技术栈，高层构建在低层之上，但用高层时不需要直接写低层代码。

```
Deep Agents   ← 顶层：开箱即用的 agent harness（基于下面两层构建）
LangGraph     ← 中层：agent 运行时 / 编排引擎（LangChain 的 agent 也跑在它上面）
LangChain     ← 底层：模型、工具、agent 循环的抽象框架
─────────────────────────────────────────────
LangSmith     ← 横向配套：可观测性 + 评估平台（框架无关，任何一层都建议配）
```

---

## 一、各自的主要能力

### LangChain —— agent 框架（解决"怎么调模型和工具"）

| 能力 | 说明 |
|---|---|
| 一行创建 agent | `create_agent(model, tools=[...])`，内置 agent 循环（思考 → 调工具 → 再思考） |
| 模型抽象 | provider 无关，OpenAI / Anthropic / 本地模型切换不改业务代码 |
| 工具生态 | 海量现成工具/集成包（搜索、数据库、SaaS API……） |
| 结构化输出 | Pydantic / Zod 约束模型输出格式 |
| RAG 管道 | 文档加载、切分、embedding、向量库检索一条龙 |
| middleware | 在 agent 循环中插入自定义钩子（人工审批、错误处理等） |

**一句话**：我要一个"调模型 + 用几个固定工具"的 agent，越快越好。

### LangGraph —— agent 运行时（解决"流程怎么精确流转、状态怎么活下去"）

| 能力 | 说明 |
|---|---|
| 显式图编排 | `StateGraph(State)` 显式定义节点、边、条件边，流程完全可控 |
| 自定义控制流 | 确定性循环、分支、并行 fan-out、反思（reflection）循环 |
| 持久化执行 | checkpointer 把状态落库，进程挂了能续跑，状态可跨会话存活 |
| 时间旅行 | 回到历史任意 checkpoint 重新执行 |
| 精准 HITL | `interrupt()` 在任意节点暂停，`Command(resume=...)` 精确恢复 |
| 长任务/流式 | 原生支持长时间运行和 token 级流式输出 |

**一句话**：我的流程不是简单的"思考-调工具"循环，我要**精确控制每一步**，且状态不能丢。

### Deep Agents —— agent harness（解决"通用 agent 的标配能力"）

| 能力 | 说明 |
|---|---|
| 任务规划 | 内置 TodoList，自动把复杂任务拆解成步骤 |
| 文件系统 | agent 可读写文件，大上下文卸载到磁盘，跨步骤携带信息 |
| 子 agent 委派 | `task` 工具 spawn 专门子 agent，隔离上下文、并行处理 |
| 持久记忆 | StoreBackend 跨会话记住用户偏好/历史结论 |
| 按需 skills | 把领域知识做成 SKILL.md，agent 用到才加载 |
| 人工审批 | HITL interrupt 内置，危险操作先审批 |

**一句话**：我要做一个像 Claude Code / CodeBuddy 那样的**通用长任务 agent**，不想自己从零搭规划、文件、子 agent 这些轮子。

### LangSmith —— 观测与评估（配套，必选）

tracing 全链路观测、在线/离线评估、prompt 管理。设三个环境变量即可接入：

```bash
LANGSMITH_API_KEY=<your-key>
LANGSMITH_TRACING=true
LANGSMITH_PROJECT=<project-name>
```

---

## 二、边界（什么时候不要用哪个）

### LangChain 不够用的时候
- agent 需要**跨多步规划**或管理超大上下文 → 上 Deep Agents
- 流程是**条件分支 / 迭代 / 并行**的确定性逻辑 → 上 LangGraph
- 状态必须**跨会话持久化** → 上 LangGraph（persistence）或 Deep Agents

### LangGraph 杀鸡用牛刀的时候
- 只是"模型 + 几个工具"的简单循环 → LangChain `create_agent` 就够了，写图是过度设计
- 你要的是规划/文件/子 agent 这些**现成能力**而不是自己编排 → Deep Agents
- 纯模型调用、无 agent 循环 → 直接用 LangChain 的 model/chain，不需要图

### Deep Agents 不合适的时候
- 任务是单一用途、固定工具集的小 agent → 太重了，用 LangChain
- 你需要**手工精雕每一条边**的控制流 → 直接用 LangGraph，harness 的封装反而碍事

### 决策顺序（按序匹配，命中即停）

```
1. 需要规划 / 文件管理 / 子 agent / 跨会话记忆 / 按需 skill？  → Deep Agents
2. 需要自定义控制流（确定性循环、分支、并行）？              → LangGraph
3. 单一用途 agent + 固定工具集？                            → LangChain create_agent
4. 纯模型调用 / RAG 检索链，无 agent 循环？                  → LangChain 直接调模型
```

---

## 三、真实 Case 选型示例

### Case 1：客服问答机器人（RAG + 固定工具）

**需求**：回答产品问题，能查知识库、查订单，没了。

**选型：LangChain `create_agent`**
- 工具固定（`search_kb`、`query_order`），流程就是标准的"思考-调工具"循环
- 用 LangChain 的 RAG 能力接向量库
- 不需要持久化状态（每次会话独立）、不需要自定义流程

**为什么不上 LangGraph/Deep Agents**：写图是过度设计；没有规划/文件/子 agent 需求。

### Case 2：报销审批工作流（确定性流程 + 人工审批）

**需求**：提交报销 → 校验发票 → 金额 > 1 万走总监审批，否则自动通过 → 打款 → 通知。审批人可能 3 天后才点按钮。

**选型：LangGraph**
- 流程是**确定性的分支逻辑**（金额判断、审批分支），不是 LLM 自由发挥
- 审批等待 3 天 → 必须 `interrupt()` 暂停 + checkpointer 持久化，恢复时 `Command(resume=...)`
- LLM 只在个别节点用（发票信息抽取）

**为什么不用 Deep Agents**：不需要 agent 自主规划，流程是写死的业务规则。

### Case 3：代码评审 agent（长任务 + 多文件 + 子任务）

**需求**：给一个 PR，agent 要自己读 diff、翻相关文件、查项目规范、分模块产出评审意见、最后汇总成报告。

**选型：Deep Agents**
- 任务需要**规划拆解**（先看 diff → 定位模块 → 逐个评审 → 汇总）
- 需要**读写文件**（读代码、把中间结论写到磁盘避免上下文爆炸）
- 需要**子 agent 委派**（每个模块一个子 agent，上下文隔离，并行评审）
- 项目规范做成 **SKILL.md** 按需加载

**为什么不用 LangChain**：单 agent 循环扛不住这么大的上下文和多步骤；**为什么不纯 LangGraph**：规划/文件/子 agent 这些轮子 Deep Agents 都造好了，自己写图重复劳动。

### Case 4：混用 —— 智能数据分析平台（真实架构模式）

**需求**：用户自然语言提问，平台自动生成分析计划、取数、跑确定性计算管道、出报告。

**选型：Deep Agents 编排 + LangGraph 子图 + LangChain 工具**

```
用户提问
  → Deep Agents 主 agent（规划：取数 → 分析 → 报告）
      ├─ task 委派 → LangGraph 编译图（数据计算管道：校验 → 计算 → 校验，确定性流程）
      ├─ LangChain 工具（SQL 查询、图表生成）
      └─ 文件系统（中间结果落盘）+ 记忆（记住用户常用的分析口径）
```

- 编译后的 LangGraph 图注册为 Deep Agents 的**命名子 agent**，主 agent 通过 `task` 工具委派，无需知道其内部结构
- LangChain 的工具/retriever 在 LangGraph 节点和 Deep Agents 工具里通用

**这是三层边界的最佳实践**：不是三选一，而是各干各擅长的。

---

## 四、对照本项目（generic-agent-service）

现状：已有 `langgraph.json` + `assistants/` 下多个 graph，属于 **LangGraph 层**用法。

- 如果定位是"**多个固定流程的 agent 服务**"（每个 assistant 一个明确图谱）→ 保持 LangGraph，合理
- 如果定位演进为"**通用 agent 服务**"（用户给模糊目标，agent 自己规划执行）→ 上移到 Deep Agents，现有 graph 可作为子 agent 保留复用

无论哪条路，先把 LangSmith 的 tracing 配上（环境变量即可），没有观测的 agent 无法迭代。
