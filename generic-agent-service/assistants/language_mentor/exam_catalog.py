"""仅从已核实授权的本地清单读取真实原题；无许可则无题。"""

import json
import secrets
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from assistants.language_mentor.exam_practice import Level, Topic, validate_paper

CONTENT_ROOT = Path(__file__).parent / "exam_content"


class LicensedEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(min_length=1, max_length=100)
    level: Level
    topic: Topic
    source_name: str = Field(min_length=1, max_length=160)
    source_url: str = Field(min_length=1, max_length=1000)
    year: str = Field(min_length=4, max_length=20)
    region: str = Field(min_length=1, max_length=100)
    license_id: str = Field(min_length=1, max_length=100)
    permission_evidence: str = Field(min_length=1, max_length=1000)
    permission_expires: date
    allow_online_display: bool
    allow_interactive_quiz: bool
    content_file: str = Field(min_length=1, max_length=160)

    @field_validator("permission_expires", mode="before")
    @classmethod
    def iso_expiry(cls, value: str) -> date:
        if not isinstance(value, str) or len(value) != 10:
            raise ValueError("授权到期日必须是 ISO 日期")
        return date.fromisoformat(value)


def _https(value: str) -> bool:
    parts = urlsplit(value)
    return parts.scheme == "https" and bool(parts.netloc) and not parts.username and not parts.password


def select_authentic(level: Level, topic: Topic, root: Path = CONTENT_ROOT) -> dict | None:
    if level == "ielts" and topic == "grammar":
        return None
    try:
        entries = json.loads((root / "manifest.json").read_text(encoding="utf-8"))["items"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ValueError("真题清单不存在或格式错误") from exc
    if not isinstance(entries, list) or len(entries) > 2000:
        raise ValueError("真题清单格式错误")
    eligible: list[LicensedEntry] = []
    for raw in entries:
        try:
            item = LicensedEntry.model_validate(raw)
        except (ValidationError, ValueError, TypeError):
            continue
        if (
            item.level != level or item.topic != topic
            or not item.allow_online_display or not item.allow_interactive_quiz
            or item.permission_expires < date.today()
            or not _https(item.source_url) or not _https(item.permission_evidence)
        ):
            continue
        eligible.append(item)
    if not eligible:
        return None
    item = secrets.choice(eligible)
    base = root.resolve()
    path = (base / item.content_file).resolve()
    if path.suffix != ".json" or not path.is_relative_to(base) or not path.is_file():
        raise ValueError("题库文件路径无效或不存在")
    try:
        paper = validate_paper(json.loads(path.read_text(encoding="utf-8")), topic)
    except (OSError, ValueError) as exc:
        raise ValueError("授权真题内容无效") from exc
    return {"paper": paper, "origin": {
        "name": item.source_name, "url": item.source_url,
        "year": item.year, "region": item.region,
    }}
