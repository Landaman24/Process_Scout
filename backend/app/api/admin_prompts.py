"""Admin API for the prompt-version registry.

Powers the CSE dashboard's prompt-version view: list / inspect / publish a new version.
Edits never overwrite — they create a new row at version+1 and deactivate the prior
active version. The `api_usage_log` keeps the prompt_version_id stamp on every call,
so historical traces stay correct after edits.
"""
import json
import logging
import time
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_admin, require_superadmin
from app.models.prompt_version import PromptVersion
from app.models.user import User
from app.schemas import PromptVersionCreate, PromptVersionOut
from app.services import activity_logger, answer_engine
from app.services.openrouter_client import DEFAULT_MODELS
from app.services.safety_gate import SafetyViolation

logger = logging.getLogger(__name__)
GOLD_SET_PATH = Path("/app/seed/gold_set.json")

router = APIRouter(prefix="/api/v1/admin/prompts", tags=["admin", "prompts"])


@router.get("", response_model=list[PromptVersionOut])
def list_prompts(
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    active_only: bool = False,
) -> list[PromptVersion]:
    q = db.query(PromptVersion)
    if active_only:
        q = q.filter(PromptVersion.is_active.is_(True))
    return q.order_by(PromptVersion.call_type, PromptVersion.version.desc()).all()


@router.get("/call-types", response_model=list[str])
def list_call_types(
    actor: Annotated[User, Depends(require_admin)],
) -> list[str]:
    return sorted(DEFAULT_MODELS.keys())


@router.get("/{call_type}", response_model=list[PromptVersionOut])
def list_versions_for_call_type(
    call_type: str,
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> list[PromptVersion]:
    rows = (
        db.query(PromptVersion)
        .filter(PromptVersion.call_type == call_type)
        .order_by(PromptVersion.version.desc())
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"No prompts found for call_type='{call_type}'")
    return rows


@router.get("/version/{version_id}", response_model=PromptVersionOut)
def get_version(
    version_id: UUID,
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> PromptVersion:
    pv = db.query(PromptVersion).filter(PromptVersion.id == version_id).first()
    if pv is None:
        raise HTTPException(status_code=404, detail="Prompt version not found")
    return pv


@router.post("", response_model=PromptVersionOut, status_code=201)
def create_version(
    payload: PromptVersionCreate,
    actor: Annotated[User, Depends(require_superadmin)],
    db: Annotated[Session, Depends(get_db)],
) -> PromptVersion:
    if payload.call_type not in DEFAULT_MODELS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown call_type '{payload.call_type}'. Register it in DEFAULT_MODELS first.",
        )

    # Find current max version and active row.
    max_version = db.execute(
        select(PromptVersion.version)
        .where(PromptVersion.call_type == payload.call_type)
        .order_by(PromptVersion.version.desc())
        .limit(1)
    ).scalar_one_or_none() or 0

    # Deactivate any currently-active versions for this call_type.
    db.query(PromptVersion).filter(
        PromptVersion.call_type == payload.call_type,
        PromptVersion.is_active.is_(True),
    ).update({"is_active": False})

    pv = PromptVersion(
        call_type=payload.call_type,
        version=max_version + 1,
        system_prompt=payload.system_prompt,
        user_template=payload.user_template,
        model=payload.model or DEFAULT_MODELS[payload.call_type],
        temperature=payload.temperature,
        max_tokens=payload.max_tokens,
        is_active=True,
        notes=payload.notes,
        created_by=actor.id,
    )
    db.add(pv)
    db.commit()
    db.refresh(pv)
    activity_logger.log_action(
        db,
        user_id=actor.id,
        action="prompt_version_create",
        target_type="prompt_version",
        target_id=str(pv.id),
        details={"call_type": pv.call_type, "version": pv.version},
    )
    return pv


@router.post("/replay-gold-set")
def replay_gold_set(
    actor: Annotated[User, Depends(require_superadmin)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=50)] = 5,
) -> dict:
    """Run the first `limit` gold-set questions through the chat pipeline against the
    currently-active answer_generation prompt. Each result becomes a regular Query row
    visible in the inquiry log. Returns a summary suitable for the CSE dashboard."""
    if not GOLD_SET_PATH.exists():
        raise HTTPException(status_code=404, detail=f"{GOLD_SET_PATH} not found")

    try:
        data = json.loads(GOLD_SET_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"gold_set.json invalid: {exc}")

    questions = data.get("questions", [])[:limit]
    if not questions:
        return {
            "ran": 0,
            "summary": {},
            "results": [],
            "total_duration_ms": 0,
        }

    started = time.perf_counter()
    counts: dict[str, int] = {}
    results: list[dict] = []

    for q in questions:
        text = q.get("question", "")
        category = q.get("category")
        try:
            r = answer_engine.answer(db, question=text, user_id=actor.id)
            counts[r.status] = counts.get(r.status, 0) + 1
            expected = q.get("expected") or {}
            results.append({
                "id": q.get("id"),
                "category": category,
                "question": text,
                "status": r.status,
                "duration_ms": r.duration_ms,
                "query_id": r.query_id,
                "chunks": len(r.chunks),
                "expected_status": expected.get("expected_status"),
                "expected_should_be_refused": expected.get("should_be_refused"),
                "expected_should_be_rejected_by_input_layer": expected.get(
                    "should_be_rejected_by_input_layer"
                ),
                "expected_clarification": expected.get("expected_clarification"),
            })
        except SafetyViolation as exc:
            counts["rejected_input"] = counts.get("rejected_input", 0) + 1
            results.append({
                "id": q.get("id"),
                "category": category,
                "question": text,
                "status": "rejected_input",
                "error": exc.reason,
            })
        except Exception as exc:
            logger.exception("gold-set replay failed for %s", q.get("id"))
            counts["error"] = counts.get("error", 0) + 1
            results.append({
                "id": q.get("id"),
                "category": category,
                "question": text,
                "status": "error",
                "error": str(exc)[:200],
            })

    total_duration_ms = int((time.perf_counter() - started) * 1000)
    activity_logger.log_action(
        db,
        user_id=actor.id,
        action="gold_set_replay",
        details={"ran": len(results), "summary": counts, "duration_ms": total_duration_ms},
    )

    return {
        "ran": len(results),
        "summary": counts,
        "results": results,
        "total_duration_ms": total_duration_ms,
    }
