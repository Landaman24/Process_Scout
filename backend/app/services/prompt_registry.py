"""Prompt-version registry — fetches the active prompt for a given call_type."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.prompt_version import PromptVersion


class PromptNotFound(RuntimeError):
    pass


def get_active(db: Session, call_type: str) -> PromptVersion:
    pv = (
        db.query(PromptVersion)
        .filter(PromptVersion.call_type == call_type, PromptVersion.is_active.is_(True))
        .order_by(PromptVersion.version.desc())
        .first()
    )
    if pv is None:
        raise PromptNotFound(f"No active prompt for call_type='{call_type}'")
    return pv


def render(template: str, **vars: object) -> str:
    return template.format(**vars)
