"""Assistants —— 插件层。每个 Assistant 一个自包含的包：

    assistants/<name>/
    ├── __init__.py   # 包说明
    ├── agent.py      # 对话图谱工厂（可选）
    ├── *.py          # 其他图谱工厂（一次性任务图谱等，可选）
    ├── prompts/      # 本 Assistant 的全部 prompt
    └── tools/        # 本 Assistant 专属工具/MCP 配置

新增 Assistant = 新建一个这样的目录 + 在 langgraph.json 路由表登记图谱。
"""


