"""Artifact identity shared by tools and download routes."""

import os

from starlette.requests import Request


async def artifact_owner(token: str | None) -> str:
    if not os.environ.get('SUPABASE_URL') and not os.environ.get('SUPABASE_ANON_KEY'):
        return 'local'
    from exam_http import _verified_user

    header = f'Bearer {token}' if token else ''
    request = Request({'type': 'http', 'method': 'GET', 'path': '/artifacts',
                       'headers': [(b'authorization', header.encode('latin-1'))]})
    return await _verified_user(request)
