# Agent 服务接入文档

面向业务方（Golang / Python / 前端）的接入说明。Agent 服务是一个标准的 HTTP API 服务（LangGraph Server），业务服务通过 REST + SSE 调用。

## 1. 服务信息

| 项 | 值 |
|---|---|
| 集群内地址 | `http://agent-service:8000`（以实际 K8s Service 名为准） |
| 协议 | HTTP/1.1，请求/响应均为 JSON；流式接口为 SSE（`text/event-stream`） |
| 图名（assistant_id） | `agent`（定义在 `langgraph.json`） |
| 健康检查 | `GET /ok` → `{"ok": true}` |
| 认证 | 当前无（集群内调用）；后续上线鉴权后在 Header 加 `x-api-key` |

## 2. 核心概念

| 概念 | 说明 | 生命周期 |
|---|---|---|
| **Assistant** | 一个 agent 图，本服务只有一个：`agent` | 部署即存在 |
| **Thread** | 一次会话，保存消息历史（存 Postgres） | 显式创建，长期保留 |
| **Run** | 在某个 thread 上执行一次 agent loop | 一次提问对应一个 run |

**无状态调用**（不需要多轮记忆）：thread_id 传 `null`，每次请求独立。
**多轮会话**：先创建 thread，后续所有 run 复用同一个 thread_id，agent 自动携带历史上下文。

三者关系（类比客服场景：Assistant 是客服窗口，Thread 是聊天窗口，Run 是每次提问后客服忙活的整轮过程）：

```text
Assistant "agent"（客服窗口，部署时固定）
    │
    ├── Thread A（和张三的会话，有历史记录）
    │       ├── Run 1（"这是什么项目？" → 查了一圈 → 回答了）
    │       ├── Run 2（"它的技术栈呢？" → 记得上文，接着答）
    │       └── Run 3（...）
    │
    └── Thread B（和李四的会话，历史完全独立）
            └── Run 1（...）
```

正常情况下业务方只需感知 thread（多轮时创建复用）；run 对象在排障时才用到（查状态、取消执行、复盘 trace）。

## 3. 接口一览

### 3.1 阻塞调用（推荐后台任务使用）

```http
POST /threads/{thread_id}/runs
Content-Type: application/json
```

`thread_id` 填实际会话 ID；无状态调用用 `POST /runs/wait`（无需先建 thread）。

请求体：

```json
{
  "assistant_id": "agent",
  "input": {
    "messages": [
      {"role": "user", "content": "深圳天气怎么样？"}
    ]
  }
}
```

响应：**agent loop 全部跑完后**返回最终 state（HTTP 200）：

```json
{
  "messages": [
    {
      "id": "0b457ab5-33dd-4b95-a1aa-fd52605f9957",
      "type": "human",
      "content": "深圳天气怎么样？"
    },
    {
      "id": "run-9f2c...",
      "type": "ai",
      "content": "",
      "tool_calls": [
        {
          "name": "get_weather",
          "args": {"city": "深圳"},
          "id": "call_8f3a2b",
          "type": "tool_call"
        }
      ],
      "additional_kwargs": {},
      "response_metadata": {}
    },
    {
      "type": "tool",
      "tool_call_id": "call_8f3a2b",
      "content": "It's always sunny in 深圳!",
      "status": "success"
    },
    {
      "type": "ai",
      "content": "深圳现在是晴天，阳光很好。"
    }
  ]
}
```

**取答案的规则：取 `messages` 数组中最后一条 `type == "ai"` 的消息，读其 `content`。**

### 3.2 流式调用（推荐对话场景使用）

```http
POST /threads/{thread_id}/runs/stream
Content-Type: application/json
Accept: text/event-stream
```

请求体在阻塞版基础上加 `stream_mode`：

```json
{
  "assistant_id": "agent",
  "input": {"messages": [{"role": "user", "content": "深圳天气怎么样？"}]},
  "stream_mode": ["messages", "updates"]
}
```

响应是标准 SSE，逐条推送：

```text
event: metadata
data: {"run_id": "01a0af3a-...", "attempt": 1}

event: messages/partial
data: [{"content": "深圳", "type": "ai", ...}, {"langgraph_node": "model", ...}]

event: updates
data: {"tools": {"messages": [{"type": "tool", "content": "It's always sunny in 深圳!", ...}]}}

event: end
data: ...
```

`stream_mode` 可选值（可传数组同时订阅多种）：

| 值 | 内容 | 适用 |
|---|---|---|
| `messages` | 逐 token 的消息增量，data 为 `[chunk, metadata]` 二元组 | 打字机效果（首选） |
| `updates` | 每个节点（model/tools）完成后的增量输出 | 展示"正在调用工具 xx" |
| `values` | 每个节点完成后的完整 state | 调试 |
| `events` | LangChain 底层回调事件（最细粒度） | 一般不用 |
| `messages-tuple` | 同 `messages` 的单值写法 | 等价于 `messages` |

**SSE 解析约定**：以 `\n\n` 分隔事件帧；每帧内 `event: xxx` 是事件类型，`data: ` 后面是 JSON（需反序列化）。连接结束以 `event: end` 或服务端关闭连接为准。

### 3.3 会话管理

```http
POST /threads                 # 创建会话 → {"thread_id": "...", ...}
GET  /threads/{tid}/state     # 查询会话当前状态（含全部消息历史）
POST /threads/{tid}/history   # 查询历史快照列表
DELETE /threads/{tid}         # 删除会话
```

## 4. 消息格式详解（LangChain 标准序列化）

每条消息都是一个 JSON 对象，字段稳定，`type` 决定角色：

| type | 含义 | 关键字段 |
|---|---|---|
| `human` | 用户输入 | `content` |
| `ai` | 模型输出 | `content`（答案）、`tool_calls`（要调的工具，可空） |
| `tool` | 工具执行结果 | `content`（结果文本）、`tool_call_id`、`status`（success/error） |

**解析注意事项（重要）：**

1. **`content` 有两种形态**，解析前先判型：
   - 字符串：`"content": "深圳现在是晴天。"`
   - content blocks 数组：`"content": [{"type": "text", "text": "深圳现在是晴天。"}, {"type": "reasoning", "reasoning": "..."}]`
   - 提取纯文本：字符串直接用；数组则拼接所有 `type == "text"` 块的 `text` 字段。
2. **`type == "ai"` 且带 `tool_calls` 时 `content` 通常为空**——这不是最终答案，agent 还在继续跑。最终答案是 loop 结束后最后一条 ai 消息。
3. `tool` 消息的 `status == "error"` 表示工具执行失败，错误信息已回填给模型自我修正，属于正常流程，**不需要调用方处理**。

## 5. 各语言接入示例

### Python（官方 SDK，推荐）

```bash
pip install langgraph-sdk
```

```python
from langgraph_sdk import get_client

client = get_client(url="http://agent-service:8000")

# 无状态阻塞调用
result = await client.runs.wait(
    None,                       # thread_id=None → 无状态
    "agent",                    # assistant_id
    input={"messages": [{"role": "user", "content": "深圳天气"}]},
)
answer = result["messages"][-1]["content"]

# 流式调用
async for chunk in client.runs.stream(
    None, "agent",
    input={"messages": [{"role": "user", "content": "深圳天气"}]},
    stream_mode="messages-tuple",
):
    if chunk.event == "messages":
        token = chunk.data[0].get("content")
        # 拼接待展示文本
```

### Golang（原生 HTTP，无官方 SDK）

```go
// 阻塞调用
type RunRequest struct {
    AssistantID string         `json:"assistant_id"`
    Input       map[string]any `json:"input"`
}

type Message struct {
    ID       string `json:"id"`
    Type     string `json:"type"`
    // content 可能是 string 也可能是 []ContentBlock，用 RawMessage 判型
    Content  json.RawMessage `json:"content"`
}

type ContentBlock struct {
    Type string `json:"type"`
    Text string `json:"text"`
}

type RunResult struct {
    Messages []Message `json:"messages"`
}

reqBody, _ := json.Marshal(RunRequest{
    AssistantID: "agent",
    Input: map[string]any{
        "messages": []map[string]string{
            {"role": "user", "content": "深圳天气"},
        },
    },
})
resp, err := http.Post(
    "http://agent-service:8000/runs/wait",
    "application/json",
    bytes.NewReader(reqBody),
)
// 解析 RunResult 后取最后一条 type=="ai" 的消息
```

提取 content 纯文本的辅助函数：

```go
func ExtractText(raw json.RawMessage) string {
    var s string
    if err := json.Unmarshal(raw, &s); err == nil {
        return s
    }
    var blocks []ContentBlock
    if err := json.Unmarshal(raw, &blocks); err != nil {
        return ""
    }
    var sb strings.Builder
    for _, b := range blocks {
        if b.Type == "text" {
            sb.WriteString(b.Text)
        }
    }
    return sb.String()
}
```

SSE 流式解析：用 `bufio.Scanner` 按行读 `resp.Body`，遇到 `data: ` 前缀的行取后续 JSON，空行表示一帧结束。注意设置足够长的 `http.Client.Timeout`（agent 执行可能持续数十秒到数分钟）。

## 6. 错误与超时

| 情况 | 表现 | 调用方建议 |
|---|---|---|
| 模型服务异常 | HTTP 500，body 含 `{"error": "...", "message": "..."}` | 指数退避重试 |
| run 执行中超时 | 阻塞调用挂起较久 | 客户端超时建议 ≥ 120s；长任务用流式 + 异步轮询 |
| agent 内部工具失败 | 不报错，tool 消息 `status=error`，模型自我修正 | 无需处理 |
| SSE 中途断连 | 连接关闭但 run 仍在服务端执行 | 用 `GET /threads/{tid}/state` 拉最终结果，不要重复发起 |

## 7. FAQ

**Q：多轮对话怎么接？**
先 `POST /threads` 拿 `thread_id`，之后每次提问都 `POST /threads/{tid}/runs`，agent 自动带历史。会话过期/清理由调用方控制（`DELETE /threads/{tid}`）。

**Q：返回内容想要固定 JSON 结构（非自然语言）？**
找 agent 服务方在图上配置 `response_format`（结构化输出 schema），最终 ai 消息的 `content` 即为符合 schema 的 JSON 字符串。

**Q：并发限制？**
agent 服务无状态部分可水平扩展（加副本）；瓶颈通常在上游模型代理的并发，压测后确定副本数。
