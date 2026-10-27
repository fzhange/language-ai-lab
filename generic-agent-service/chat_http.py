"""Authenticated, identity-based deletion of completed mentor replies."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from langgraph_sdk import get_client
from pydantic import BaseModel, ConfigDict, Field

from core.artifact_auth import artifact_owner
from core.pg_persistence import create_checkpointer

router = APIRouter(prefix='/chat', tags=['chat'])


class DeleteReply(BaseModel):
    model_config = ConfigDict(extra='forbid')
    checkpoint_id: str = Field(min_length=1, max_length=100)


@router.delete('/{thread_id}/replies/{message_id}')
async def delete_reply(thread_id: UUID, message_id: str, body: DeleteReply, request: Request):
    if not message_id or len(message_id) > 200:
        raise HTTPException(400, '消息标识无效')
    header = request.headers.get('Authorization', '')
    owner = await artifact_owner(header[7:] if header.startswith('Bearer ') else None)
    async with create_checkpointer() as saver:
        current = await saver.aget_tuple({'configurable': {'thread_id': str(thread_id)}})
        if not current or (owner != 'local' and current.metadata.get('user_id') != owner):
            raise HTTPException(404, '对话不存在或不可访问')
        thread = await get_client().threads.get(str(thread_id))
        if thread['status'] != 'idle':
            raise HTTPException(409, '请等待导师回复完成后再删除')
        await saver.delete_reply(str(thread_id), message_id, owner, body.checkpoint_id)
    return {'deleted_message_id': message_id}


@router.delete('/{thread_id}/turns/{human_id}')
async def delete_turn(thread_id: UUID, human_id: str, body: DeleteReply, request: Request):
    """Delete one question/answer turn together with any learning cards it produced."""
    if not human_id or len(human_id) > 200:
        raise HTTPException(400, '消息标识无效')
    header = request.headers.get('Authorization', '')
    owner = await artifact_owner(header[7:] if header.startswith('Bearer ') else None)
    async with create_checkpointer() as saver:
        current = await saver.aget_tuple({'configurable': {'thread_id': str(thread_id)}})
        if not current or (owner != 'local' and current.metadata.get('user_id') != owner):
            raise HTTPException(404, '对话不存在或不可访问')
        thread = await get_client().threads.get(str(thread_id))
        if thread['status'] != 'idle':
            raise HTTPException(409, '请等待导师回复完成后再删除')
        await saver.delete_turn(str(thread_id), human_id, owner, body.checkpoint_id)
    return {'deleted_turn_id': human_id}
