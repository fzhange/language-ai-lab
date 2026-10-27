"""Validate persisted mentor turns before reconstructing conversation state."""

from collections.abc import Sequence


def keep_other_turns(messages: Sequence[dict], human_id: str) -> list[dict]:
    if not messages or not isinstance(human_id, str) or not human_id:
        raise LookupError('找不到待删除的用户消息')
    seen_ids: set[str] = set()
    known_calls: set[str] = set()
    human_indices: list[int] = []
    for index, message in enumerate(messages):
        kind, message_id = message.get('type'), message.get('id')
        if kind not in {'human', 'ai', 'tool'} or not isinstance(message_id, str) or not message_id or message_id in seen_ids:
            raise ValueError('消息缺少唯一标识或类型不受支持')
        seen_ids.add(message_id)
        if kind == 'human':
            human_indices.append(index)
        if kind == 'ai':
            for call in message.get('tool_calls') or []:
                call_id = call.get('id') if isinstance(call, dict) else None
                if not isinstance(call_id, str) or not call_id or call_id in known_calls:
                    raise ValueError('工具调用无法安全关联')
                known_calls.add(call_id)
        if kind == 'tool' and message.get('tool_call_id') not in known_calls:
            raise ValueError('工具结果找不到所属调用')
    if not human_indices or human_indices[0] != 0 or messages[-1]['type'] != 'ai':
        raise ValueError('对话轮次尚未完整，暂不能删除')
    positions = [index for index in human_indices if messages[index]['id'] == human_id]
    if len(positions) != 1:
        raise LookupError('找不到待删除的用户消息')
    start = positions[0]
    end = next((index for index in human_indices if index > start), len(messages))
    if messages[end - 1]['type'] != 'ai':
        raise ValueError('待删除轮次尚未完成')
    removed = messages[start:end]
    retained = list(messages[:start]) + list(messages[end:])
    removed_call_ids = {call['id'] for message in removed if message['type'] == 'ai' for call in message.get('tool_calls') or []}
    for message in retained:
        if message['type'] == 'tool' and message.get('tool_call_id') in removed_call_ids:
            raise ValueError('其他轮次依赖待删除的工具调用')
        content = message.get('content')
        if message['type'] == 'human' and isinstance(content, str) and content.startswith('理解检查回答：\n'):
            import json
            try:
                answer = json.loads(content.partition('\n')[2])
            except (ValueError, TypeError):
                raise ValueError('无法安全识别后续理解检查的关联') from None
            if answer.get('check_id') in removed_call_ids:
                raise ValueError('后续回答依赖待删除的理解检查')
    return retained
