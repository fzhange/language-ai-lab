"""Deep Agents backends demo: StateBackend, FilesystemBackend, LocalShellBackend, StoreBackend, CompositeBackend.

Run individual demos:
    python backends_demo.py state
    python backends_demo.py filesystem
    python backends_demo.py localshell
    python backends_demo.py store
    python backends_demo.py composite
"""

import sys

from dotenv import load_dotenv

# override=True：conda 环境预置了 OPENAI_API_KEY（智谱原生 key），必须让 .env 里的代理 key 覆盖它
load_dotenv(override=True)

import os

# 方案 B：与本地其他 graph 共用一个项目，靠 tags 区分（常量在 core/tracing.py）
os.environ.setdefault("LANGSMITH_PROJECT", "generic-agent-service")

from deepagents import create_deep_agent
from deepagents.backends import (
    CompositeBackend,
    FilesystemBackend,
    LocalShellBackend,
    StateBackend,
    StoreBackend,
)
from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore  # use PostgresStore in production
from langgraph.types import Command

from core.model import get_chat_model  # CodeBuddy 代理只支持 chat completions，已关闭 Responses API
from core.tracing import BACKENDS_DEMO, tagged_config


def run_with_approval(agent, content: str, config: dict):
    """Invoke agent and interactively approve/reject any interrupts.

    interrupt 不是交互弹窗：graph 暂停，审批请求放在 result["__interrupt__"] 里，
    必须用 Command(resume={"decisions": [...]}) 恢复执行。
    """
    config = tagged_config(config, BACKENDS_DEMO)
    result = agent.invoke({"messages": [{"role": "user", "content": content}]}, config=config)
    while "__interrupt__" in result:
        interrupt = result["__interrupt__"][0]
        action_requests = interrupt.value.get("action_requests", [])
        print("\n===== 人工审批 =====")
        for action in action_requests:
            print(f"工具: {action.get('name')}  参数: {action.get('args')}")
        choice = input("批准执行吗？[approve/reject] ").strip().lower()
        decision = "reject" if choice.startswith("r") else "approve"
        decisions = [{"type": decision} for _ in action_requests]
        result = agent.invoke(Command(resume={"decisions": decisions}), config=config)
    return result


def demo_state_backend():
    """1. StateBackend (default): ephemeral, thread-scoped files in graph state."""
    agent = create_deep_agent(model=get_chat_model())  # StateBackend is default

    config = tagged_config({"configurable": {"thread_id": "thread-1"}}, BACKENDS_DEMO)
    result = agent.invoke(
        {"messages": [{"role": "user", "content": "Write short notes to /draft.txt, then read it back."}]},
        config=config,
    )
    print(result["messages"][-1].content)
    # /draft.txt only exists within thread-1; a new thread_id won't see it.


def demo_filesystem_backend():
    """2. FilesystemBackend: real disk access (local dev / CLI only)."""
    import os

    os.makedirs("./workspace", exist_ok=True)
    agent = create_deep_agent(
        model=get_chat_model(),
        # virtual_mode=True restricts access to root_dir (blocks ../ and ~ escapes)
        backend=FilesystemBackend(root_dir="./workspace", virtual_mode=True),
        interrupt_on={"write_file": True, "edit_file": True},  # approve before disk writes
        checkpointer=MemorySaver(),  # required for interrupts
    )
    result = run_with_approval(agent, "Create hello.txt with a greeting.", {"configurable": {"thread_id": "fs-1"}})
    print(result["messages"][-1].content)
    # Security: never use FilesystemBackend in a web server.


def demo_local_shell_backend():
    """3. LocalShellBackend: FilesystemBackend + execute tool (shell on host, NO sandbox).

    Commands run via subprocess.run(shell=True) with root_dir as cwd, but can access
    ANY path on the system. Only use in controlled dev environments.
    """
    import os

    os.makedirs("./workspace", exist_ok=True)
    agent = create_deep_agent(
        model=get_chat_model(),
        backend=LocalShellBackend(
            root_dir="./workspace",
            virtual_mode=True,      # filesystem tools 限制在 root_dir（execute 不受此限！）
            inherit_env=True,       # shell 继承当前进程环境变量（也可用 env={...} 指定白名单）
            timeout=120,            # 单条命令超时（秒）
            max_output_bytes=100_000,
        ),
        # execute 跑的是真实 shell 命令，务必审批
        interrupt_on={"execute": True, "write_file": True, "edit_file": True},
        checkpointer=MemorySaver(),
    )
    result = run_with_approval(
        agent,
        "Create hello.txt with a greeting, then run `ls -la` and `cat hello.txt` to verify.",
        {"configurable": {"thread_id": "shell-1"}},
    )
    print(result["messages"][-1].content)


def demo_store_backend():
    """4. StoreBackend: long-term memory persisted across threads (requires a store).

    deepagents>=0.7: pass backend instances directly (factories removed);
    StoreBackend requires a namespace factory (rt -> tuple) for data isolation.
    """
    store = InMemoryStore()

    agent = create_deep_agent(
        model=get_chat_model(),
        backend=StoreBackend(namespace=lambda rt: ("filesystem",)),
        store=store,  # required! StoreBackend fails without it
    )

    # thread-1 writes:
    agent.invoke(
        {"messages": [{"role": "user", "content": "Save 'prefers concise answers' to /prefs.txt"}]},
        config=tagged_config({"configurable": {"thread_id": "thread-1"}}, BACKENDS_DEMO),
    )
    # thread-2 can read it:
    result = agent.invoke(
        {"messages": [{"role": "user", "content": "What's in /prefs.txt?"}]},
        config=tagged_config({"configurable": {"thread_id": "thread-2"}}, BACKENDS_DEMO),
    )
    print(result["messages"][-1].content)


def demo_composite_backend():
    """5. CompositeBackend: route path prefixes to different backends (longest prefix wins)."""
    store = InMemoryStore()

    agent = create_deep_agent(
        model=get_chat_model(),
        backend=CompositeBackend(
            default=StateBackend(),  # everything else is ephemeral (agent 内部数据也走这里)
            routes={
                "/memories/": StoreBackend(namespace=lambda rt: ("memories",)),  # persistent
                "/memories/temp/": StateBackend(),  # longer prefix overrides
            },
        ),
        store=store,
    )

    config = tagged_config({"configurable": {"thread_id": "thread-1"}}, BACKENDS_DEMO)
    agent.invoke(
        {"messages": [{"role": "user", "content": (
            "Write /draft.txt (ephemeral), /memories/style.txt (persistent), "
            "and /memories/temp/x.txt (ephemeral)."
        )}]},
        config=config,
    )
    # /memories/style.txt is readable from any other thread_id; the others are not.


if __name__ == "__main__":
    demos = {
        "state": demo_state_backend,
        "filesystem": demo_filesystem_backend,
        "localshell": demo_local_shell_backend,
        "store": demo_store_backend,
        "composite": demo_composite_backend,
    }
    name = sys.argv[1] if len(sys.argv) > 1 else "state"
    if name not in demos:
        print(f"Unknown demo '{name}'. Choose from: {', '.join(demos)}")
        sys.exit(1)
    demos[name]()
