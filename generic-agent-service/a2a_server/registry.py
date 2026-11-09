"""A2A 自注册(self-registry)：把本中台的 assistant 描述成 A2A Agent Card。

设计说明
========
- 自注册 = Well-Known URI 发现策略：每个 assistant 自己产出一张合规的 Agent
  Card，挂在 /.well-known/... 下。consumer 知道地址即可 GET 发现，不依赖任何
  外部 registry center（见 a2a_server/http.py 的路由）。
- 这里只放纯数据与卡片构建，不碰网络、不碰 LangGraph，便于单测。
- graph_id 必须与 langgraph.json 中注册的 graph id 一致；A2A 端点收到
  message/send 后据此路由到对应图谱。
- 身份红线：需要用户数据的 agent（如 vocab-quiz）声明 bearer 安全方案，JWT 由
  传输层(Authorization 头)注入 run config，绝不取自对话文本。
"""

from __future__ import annotations

from dataclasses import dataclass

# A2A 协议版本（信息性字段；卡片 schema 对齐 A2A v0.3.x）
PROTOCOL_VERSION = "0.3.0"
# 本中台对外声明的组织信息
PROVIDER = {"organization": "language-ai-lab", "url": "https://github.com/"}


@dataclass(frozen=True)
class A2AAgent:
    """一个对外暴露的 A2A agent（= 本中台的一个 graph）。"""

    id: str  # URL slug，用于 /a2a/{id} 与 well-known 路径
    graph_id: str  # langgraph.json 中的 graph id
    factory: str  # 图谱工厂 "module:attr"，A2A 桥接直接在进程内 invoke（避免嵌套 run 死锁）
    name: str
    description: str
    skills: list[dict]
    streaming: bool = False  # 卡片能力声明；当前 message/send 桥接为非流式
    requires_auth: bool = False  # True 时声明 bearer 安全方案
    default_input_modes: tuple[str, ...] = ("text/plain",)
    default_output_modes: tuple[str, ...] = ("text/plain", "text/markdown")


# 对外暴露的 agent 清单（本中台的 "provider 自注册" 来源）。
# 新增 assistant 想被 A2A 发现时，在此追加一条即可。
AGENTS: tuple[A2AAgent, ...] = (
    A2AAgent(
        id="language-mentor",
        graph_id="language-mentor",
        factory="assistants.language_mentor.agent:make_language_mentor",
        name="Language Mentor",
        description=(
            "英语学习对话导师：只读检索 nature-of-language 知识库、查询用户高亮，"
            "按 '理解而非死记' 讲解语言现象。"
        ),
        streaming=True,
        requires_auth=True,
        skills=[
            {
                "id": "language-tutoring",
                "name": "语言导师对话",
                "description": "围绕语法/词汇/用法做对话式讲解，可结合用户高亮素材。",
                "tags": ["tutoring", "english", "grammar", "vocabulary"],
                "examples": [
                    "帮我讲清楚 used to 和 be used to 的区别",
                    "用我最近高亮的词出几句例句",
                ],
            }
        ],
    ),
    A2AAgent(
        id="writing-coach",
        graph_id="writing-coach",
        factory="assistants.language_mentor.study:make_writing_coach_graph",
        name="Writing Coach",
        description=(
            "雅思写作批改：按 TR/CC/LR/GRA 四维度评分，中文解释、英文示范。"
            "一次性任务，无需用户身份。"
        ),
        streaming=False,
        requires_auth=False,
        skills=[
            {
                "id": "ielts-writing-feedback",
                "name": "雅思写作批改",
                "description": "输入作文原文，输出四维度评分与改写建议。",
                "tags": ["ielts", "writing", "feedback"],
                "examples": ["批改这篇 Task 2 作文：..."],
            }
        ],
    ),
    A2AAgent(
        id="vocab-quiz",
        graph_id="vocab-quiz",
        factory="assistants.language_mentor.study:make_vocab_quiz_graph",
        name="Vocab Quiz",
        description=(
            "基于用户 Supabase 高亮出题/批改。需用户身份(JWT)以按 RLS 读取高亮。"
        ),
        streaming=False,
        requires_auth=True,
        skills=[
            {
                "id": "vocab-quiz-from-highlights",
                "name": "高亮词汇测验",
                "description": "读取用户高亮生成测验；同会话再次调用进入批改模式。",
                "tags": ["quiz", "vocabulary", "highlights"],
                "examples": ["根据我的高亮出 5 道词汇题"],
            }
        ],
    ),
)

_BY_ID = {agent.id: agent for agent in AGENTS}
# 默认的 flagship agent，用于托管在 origin 根 /.well-known/agent-card.json
PRIMARY_AGENT_ID = "language-mentor"


def get_agent(agent_id: str) -> "A2AAgent | None":
    return _BY_ID.get(agent_id)


def _security(agent: A2AAgent) -> dict:
    if not agent.requires_auth:
        return {}
    return {
        "securitySchemes": {
            "bearer": {
                "type": "http",
                "scheme": "bearer",
                "bearerFormat": "JWT",
                "description": "Supabase 会话 JWT；经 Authorization 头注入，按 RLS 授权。",
            }
        },
        "security": [{"bearer": []}],
    }


def build_card(agent: A2AAgent, base_url: str) -> dict:
    """根据请求来源 base_url 生成一张完整的 A2A Agent Card。"""
    base = base_url.rstrip("/")
    card = {
        "protocolVersion": PROTOCOL_VERSION,
        "name": agent.name,
        "description": agent.description,
        "url": f"{base}/a2a/{agent.id}",
        "preferredTransport": "JSONRPC",
        "version": "0.0.0",
        "provider": PROVIDER,
        "capabilities": {
            "streaming": agent.streaming,
            "pushNotifications": False,
            "stateTransitionHistory": False,
        },
        "defaultInputModes": list(agent.default_input_modes),
        "defaultOutputModes": list(agent.default_output_modes),
        "skills": [dict(skill) for skill in agent.skills],
    }
    card.update(_security(agent))
    return card


def build_catalog(base_url: str) -> dict:
    """本机自托管的注册目录(registry index)：列出全部 provider 卡片。"""
    return {"agents": [build_card(agent, base_url) for agent in AGENTS]}
