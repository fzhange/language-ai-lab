"""Remove a message by identity without altering other messages or tool pairs."""

from langchain_core.messages import BaseMessage
from langgraph.checkpoint.serde.types import _DeltaSnapshot

_REMOVED = object()


def scrub_messages(value, message_ids):
    if isinstance(value, _DeltaSnapshot):
        return _DeltaSnapshot(scrub_messages(value.value, message_ids))
    if isinstance(value, BaseMessage):
        return _REMOVED if value.id in message_ids else value
    if isinstance(value, dict):
        if value.get('type') in {'ai', 'human', 'tool', 'AIMessage', 'HumanMessage', 'ToolMessage'}:
            identity = value.get('id') or (value.get('kwargs') or {}).get('id')
            if isinstance(identity, str) and identity in message_ids:
                return _REMOVED
        result = {}
        for key, item in value.items():
            cleaned = scrub_messages(item, message_ids)
            if cleaned is not _REMOVED:
                result[key] = cleaned
        return result
    if isinstance(value, (list, tuple)):
        cleaned = [scrub_messages(item, message_ids) for item in value]
        remaining = [item for item in cleaned if item is not _REMOVED]
        return tuple(remaining) if isinstance(value, tuple) else remaining
    return value


def find_reply(value, message_id):
    if isinstance(value, BaseMessage):
        return value if value.id == message_id and value.type == 'ai' and not getattr(value, 'tool_calls', None) else None
    if isinstance(value, dict):
        values = value.values()
    elif isinstance(value, (list, tuple)):
        values = value
    else:
        return None
    for item in values:
        reply = find_reply(item, message_id)
        if reply is not None:
            return reply
    return None


def as_message_dicts(value):
    """Return a flat list of plain message dicts (id/type/content/tool_calls) found in a saved messages value.

    Checkpoints store LangChain message objects, while ``keep_other_turns`` works on plain dicts.
    """
    if isinstance(value, _DeltaSnapshot):
        return as_message_dicts(value.value)
    if not isinstance(value, (list, tuple)):
        return []
    messages = []
    for item in value:
        if isinstance(item, BaseMessage):
            messages.append({'type': item.type, 'id': item.id, 'content': item.content,
                             'tool_calls': [{'id': c.get('id'), 'name': c.get('name')} for c in getattr(item, 'tool_calls', None) or []],
                             'tool_call_id': getattr(item, 'tool_call_id', None)})
        elif isinstance(item, dict) and item.get('type') in {'human', 'ai', 'tool'}:
            messages.append(item)
        elif isinstance(item, (list, tuple, _DeltaSnapshot)):
            messages.extend(as_message_dicts(item))
    return messages
