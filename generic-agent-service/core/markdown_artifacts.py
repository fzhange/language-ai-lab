"""Immutable Markdown artifacts in a private S3-compatible bucket."""

import base64
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

MAX_CONTENT_BYTES = 200_000


def _bucket() -> str:
    return os.environ.get('SEAWEEDFS_S3_BUCKET', 'documents')


def _s3_client():
    endpoint = os.environ.get('SEAWEEDFS_S3_ENDPOINT_URL', '')
    access_key = os.environ.get('SEAWEEDFS_S3_ACCESS_KEY_ID', '')
    secret_key = os.environ.get('SEAWEEDFS_S3_SECRET_ACCESS_KEY', '')
    ca_bundle = Path(os.environ.get('SEAWEEDFS_S3_CA_BUNDLE', ''))
    parsed = urlparse(endpoint)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.path not in ('', '/')
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or not access_key or not secret_key or not ca_bundle.is_absolute() or not ca_bundle.is_file()):
        raise ValueError('请配置 SeaweedFS S3 endpoint、密钥与本地 CA 证书绝对路径')
    return boto3.client(
        's3', endpoint_url=endpoint, region_name='us-east-1',
        aws_access_key_id=access_key, aws_secret_access_key=secret_key,
        verify=str(ca_bundle),
        config=Config(signature_version='s3v4', s3={'addressing_style': 'path'},
                      connect_timeout=5, read_timeout=15),
    )


def _valid_filename(filename: str) -> bool:
    return (filename.endswith('.md') and not filename.startswith('.') and len(filename.encode()) <= 180
            and not any(char in '/\\' or ord(char) < 32 or ord(char) == 127 for char in filename))


def _key(artifact_id: str) -> str:
    if not re.fullmatch(r'[a-f0-9]{64}', artifact_id):
        raise FileNotFoundError('产物不存在')
    return f'markdown/{artifact_id}.md'


def _get(client, artifact_id: str, owner: str) -> tuple[str, str]:
    try:
        response = client.get_object(Bucket=_bucket(), Key=_key(artifact_id))
    except ClientError as exc:
        if exc.response.get('Error', {}).get('Code') in ('NoSuchKey', 'NotFound', '404'):
            raise FileNotFoundError('产物不存在') from None
        raise
    metadata = response['Metadata']
    body = response['Body']
    try:
        if metadata.get('owner') != hashlib.sha256(owner.encode()).hexdigest():
            raise FileNotFoundError('产物不存在')
        filename = base64.urlsafe_b64decode(metadata['filename']).decode('utf-8')
        if not _valid_filename(filename):
            raise ValueError('产物文件名无效')
        content_bytes = body.read(MAX_CONTENT_BYTES + 1)
        if len(content_bytes) > MAX_CONTENT_BYTES or hashlib.sha256(content_bytes).hexdigest() != metadata['digest']:
            raise ValueError('产物校验失败')
        return filename, content_bytes.decode('utf-8')
    finally:
        body.close()


def load_markdown(artifact_id: str, owner: str) -> tuple[str, str]:
    _key(artifact_id)
    return _get(_s3_client(), artifact_id, owner)


def save_markdown(*, owner: str, thread_id: str, tool_call_id: str, filename: str, content: str) -> dict[str, str]:
    if not _valid_filename(filename):
        raise ValueError('文件名必须是普通 .md 文件名，不能包含目录或控制字符')
    data = content.encode('utf-8')
    if not content.strip() or len(data) > MAX_CONTENT_BYTES:
        raise ValueError('Markdown 内容不能为空，且不能超过 200 KB')
    if not owner or not thread_id or not tool_call_id:
        raise ValueError('缺少会话或工具调用标识')
    artifact_id = hashlib.sha256(json.dumps([owner, thread_id, tool_call_id]).encode()).hexdigest()
    metadata = {
        'owner': hashlib.sha256(owner.encode()).hexdigest(),
        'filename': base64.urlsafe_b64encode(filename.encode()).decode('ascii'),
        'digest': hashlib.sha256(data).hexdigest(),
    }
    client = _s3_client()
    try:
        client.put_object(Bucket=_bucket(), Key=_key(artifact_id), Body=data, Metadata=metadata,
                          ContentType='text/markdown; charset=utf-8', IfNoneMatch='*')
    except ClientError as exc:
        if exc.response.get('Error', {}).get('Code') not in ('PreconditionFailed', '412', 'ConditionalRequestConflict', '409'):
            raise
        existing_filename, existing_content = _get(client, artifact_id, owner)
        if existing_filename != filename or existing_content != content:
            raise ValueError('同一次工具调用不能修改已创建的产物') from None
    return {'type': 'markdown_artifact', 'artifact_id': artifact_id, 'filename': filename,
            'download_path': f'/artifacts/{artifact_id}/download'}
