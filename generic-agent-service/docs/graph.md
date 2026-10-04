
图谱 = 一张"流程图"，描述 Agent 处理一次请求要经过哪些步骤（节点）、按什么顺序走（边）、携带什么数据（状态）。 
LangGraph 把这张图编译成一个可以被 HTTP 调用的服务单元，叫 graph。
对话型图谱（assistants/highlight_buddy/agent.py）：

    用户提问 → [model 节点：LLM 思考] → 要调工具吗？
                ↑                      ├─ 要 → [tools 节点：执行] → 回到 model
                │                      └─ 不要 → 输出回复
                └── 状态 = messages 列表（整个对话历史）
              
一次性图谱（assistants/highlight_buddy/study.py）：

    输入 → [generate 节点] → 结束
