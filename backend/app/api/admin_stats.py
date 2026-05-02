"""Admin Dashboard stat summary.

Aggregates the queries table over a rolling window and asks Sonnet to produce a
one-paragraph plain-English summary. Result is cached in Redis for an hour so an
admin opening the dashboard repeatedly doesn't burn Sonnet calls.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated

import redis
from fastapi import APIRouter, Depends, Query
from redis.exceptions import RedisError
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.dependencies import require_admin
from app.models.api_usage_log import ApiUsageLog
from app.models.feedback import Feedback
from app.models.query import Query as QueryRow
from app.models.user import User
from app.services import prompt_registry
from app.services.openrouter_client import OpenRouterClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin/stats", tags=["admin", "stats"])

CACHE_TTL_SECONDS = 3600
TOP_EQUIPMENT_LIMIT = 5
TOP_ERRORS_LIMIT = 3

_settings = get_settings()
_redis_client: redis.Redis | None = None


def _redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(_settings.REDIS_URL, decode_responses=True)
    return _redis_client


@router.get("/by-user")
def stats_by_user(
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> dict:
    """Per-user engagement summary: lifetime inquiries, inquiries in the last N
    days, and feedback given. Powers the Usage Dashboard's by-user table.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # All-time inquiry counts by user
    alltime_rows = (
        db.query(QueryRow.user_id, func.count(QueryRow.id))
        .filter(QueryRow.user_id.isnot(None))
        .group_by(QueryRow.user_id)
        .all()
    )
    alltime: dict = {r[0]: int(r[1]) for r in alltime_rows}

    # Window inquiry counts
    window_rows = (
        db.query(QueryRow.user_id, func.count(QueryRow.id))
        .filter(QueryRow.user_id.isnot(None), QueryRow.created_at >= cutoff)
        .group_by(QueryRow.user_id)
        .all()
    )
    window: dict = {r[0]: int(r[1]) for r in window_rows}

    # Feedback counts (per-answer ratings only — exclude the generic issue form
    # by filtering on rating IS NOT NULL)
    feedback_rows = (
        db.query(Feedback.user_id, func.count(Feedback.id))
        .filter(Feedback.user_id.isnot(None), Feedback.rating.isnot(None))
        .group_by(Feedback.user_id)
        .all()
    )
    feedback_counts: dict = {r[0]: int(r[1]) for r in feedback_rows}

    user_ids = set(alltime.keys()) | set(window.keys()) | set(feedback_counts.keys())
    if not user_ids:
        return {"days": days, "users": []}

    user_rows = db.query(User.id, User.email, User.full_name).filter(User.id.in_(user_ids)).all()
    users = []
    for uid, email, name in user_rows:
        users.append({
            "user_id": str(uid),
            "user_email": email,
            "user_name": name,
            "total_queries": alltime.get(uid, 0),
            "queries_in_window": window.get(uid, 0),
            "feedback_count": feedback_counts.get(uid, 0),
        })
    users.sort(key=lambda u: (-u["queries_in_window"], -u["total_queries"]))
    return {"days": days, "users": users}


@router.get("/by-equipment")
def stats_by_equipment(
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> dict:
    """Per-equipment inquiry distribution: lifetime + window counts.

    Includes a row for queries with null equipment_context (rendered as
    "uncategorized" by the frontend) so the bucket of unclassified questions
    is visible — it's a quality signal for query_understanding.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    alltime_rows = (
        db.query(QueryRow.equipment_context, func.count(QueryRow.id))
        .group_by(QueryRow.equipment_context)
        .all()
    )
    alltime: dict = {r[0]: int(r[1]) for r in alltime_rows}

    window_rows = (
        db.query(QueryRow.equipment_context, func.count(QueryRow.id))
        .filter(QueryRow.created_at >= cutoff)
        .group_by(QueryRow.equipment_context)
        .all()
    )
    window: dict = {r[0]: int(r[1]) for r in window_rows}

    keys = set(alltime.keys()) | set(window.keys())
    items = [
        {
            "equipment": k,
            "total_queries": alltime.get(k, 0),
            "queries_in_window": window.get(k, 0),
        }
        for k in keys
    ]
    items.sort(key=lambda r: (-r["total_queries"], -r["queries_in_window"]))
    return {"days": days, "equipment": items}


@router.get("/activity")
def stats_activity(
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    days: Annotated[int, Query(ge=1, le=90)] = 7,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    """Unified feed of user-engagement events: queries asked + feedback given.

    Returned in reverse-chronological order, capped at `limit` items combined.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Pull recent queries with user emails (LEFT JOIN — keep events even if the user was deleted)
    query_rows = (
        db.query(
            QueryRow.id,
            QueryRow.created_at,
            QueryRow.question,
            QueryRow.status,
            QueryRow.equipment_context,
            QueryRow.duration_ms,
            User.email,
            User.full_name,
        )
        .outerjoin(User, User.id == QueryRow.user_id)
        .filter(QueryRow.created_at >= cutoff)
        .order_by(QueryRow.created_at.desc())
        .limit(limit)
        .all()
    )

    feedback_rows = (
        db.query(
            Feedback.id,
            Feedback.created_at,
            Feedback.rating,
            Feedback.message,
            Feedback.query_id,
            User.email,
            User.full_name,
        )
        .outerjoin(User, User.id == Feedback.user_id)
        .filter(Feedback.created_at >= cutoff, Feedback.rating.isnot(None))
        .order_by(Feedback.created_at.desc())
        .limit(limit)
        .all()
    )

    events: list[dict] = []
    for r in query_rows:
        events.append({
            "type": "query",
            "at": r[1].isoformat(),
            "user_email": r[6],
            "user_name": r[7],
            "query_id": str(r[0]),
            "question": r[2][:240],
            "status": r[3],
            "equipment_context": r[4],
            "duration_ms": r[5],
        })
    for r in feedback_rows:
        comment = r[3]
        # Strip the auto-fill "(thumbs_up)"/"(thumbs_down)" placeholder when the user didn't comment.
        clean_comment = None if comment and comment.startswith("(thumbs_") else comment
        events.append({
            "type": "feedback",
            "at": r[1].isoformat(),
            "user_email": r[5],
            "user_name": r[6],
            "query_id": str(r[4]) if r[4] else None,
            "rating": r[2],
            "comment": clean_comment,
        })

    events.sort(key=lambda e: e["at"], reverse=True)
    return {"days": days, "events": events[:limit]}


@router.get("/summary")
def stats_summary(
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    days: Annotated[int, Query(ge=1, le=90)] = 7,
    refresh: Annotated[bool, Query()] = False,
) -> dict:
    """Aggregate stats + LLM-generated paragraph for the last N days.

    Counts/aggregates always recompute on every call (cheap SQL).
    The Sonnet paragraph is cached separately, keyed by a hash of the inputs:
    if the numbers haven't changed since the last paragraph, reuse it; otherwise
    regenerate. `refresh=true` forces regeneration.
    """
    return _build_payload(db, days=days, force_regen=refresh)


def _build_payload(db: Session, *, days: int, force_regen: bool = False) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    total_queries = (
        db.query(func.count(QueryRow.id)).filter(QueryRow.created_at >= cutoff).scalar() or 0
    )

    by_status_rows = (
        db.query(QueryRow.status, func.count(QueryRow.id))
        .filter(QueryRow.created_at >= cutoff)
        .group_by(QueryRow.status)
        .all()
    )
    by_status = {row[0]: int(row[1]) for row in by_status_rows}

    top_equipment_rows = (
        db.query(QueryRow.equipment_context, func.count(QueryRow.id))
        .filter(QueryRow.created_at >= cutoff, QueryRow.equipment_context.isnot(None))
        .group_by(QueryRow.equipment_context)
        .order_by(desc(func.count(QueryRow.id)))
        .limit(TOP_EQUIPMENT_LIMIT)
        .all()
    )
    top_equipment = [{"equipment": r[0], "count": int(r[1])} for r in top_equipment_rows]

    avg_duration_ms = (
        db.query(func.avg(QueryRow.duration_ms))
        .filter(QueryRow.created_at >= cutoff, QueryRow.duration_ms.isnot(None))
        .scalar()
    )
    avg_duration_ms = int(avg_duration_ms) if avg_duration_ms is not None else None

    # Most active user (by query count) and top feedback contributor in window.
    # Pre-format as display strings so the prompt template gets clean text.
    top_querier = (
        db.query(QueryRow.user_id, func.count(QueryRow.id).label("c"))
        .filter(QueryRow.created_at >= cutoff, QueryRow.user_id.isnot(None))
        .group_by(QueryRow.user_id)
        .order_by(desc("c"))
        .limit(1)
        .first()
    )
    top_feedback = (
        db.query(Feedback.user_id, func.count(Feedback.id).label("c"))
        .filter(
            Feedback.created_at >= cutoff,
            Feedback.user_id.isnot(None),
            Feedback.rating.isnot(None),
        )
        .group_by(Feedback.user_id)
        .order_by(desc("c"))
        .limit(1)
        .first()
    )
    needed_ids = {r[0] for r in (top_querier, top_feedback) if r is not None}
    user_lookup: dict = {}
    if needed_ids:
        rows = db.query(User.id, User.full_name, User.email).filter(User.id.in_(needed_ids)).all()
        user_lookup = {r[0]: (r[1] or r[2] or "unknown") for r in rows}

    most_active_user = (
        f"{user_lookup.get(top_querier[0], 'unknown')} ({int(top_querier[1])} questions)"
        if top_querier else "no activity"
    )
    top_feedback_user = (
        f"{user_lookup.get(top_feedback[0], 'unknown')} ({int(top_feedback[1])} ratings)"
        if top_feedback else "no feedback yet"
    )

    top_error_rows = (
        db.query(QueryRow.error, func.count(QueryRow.id))
        .filter(
            QueryRow.created_at >= cutoff,
            QueryRow.status == "failed",
            QueryRow.error.isnot(None),
        )
        .group_by(QueryRow.error)
        .order_by(desc(func.count(QueryRow.id)))
        .limit(TOP_ERRORS_LIMIT)
        .all()
    )
    top_errors = [{"error": (r[0] or "")[:200], "count": int(r[1])} for r in top_error_rows]

    total_cost_usd = (
        db.query(func.coalesce(func.sum(ApiUsageLog.estimated_cost_usd), 0.0))
        .filter(ApiUsageLog.timestamp >= cutoff)
        .scalar()
    )
    total_cost_usd = float(total_cost_usd or 0.0)

    # Per-day inquiry counts. We bucket by date (UTC) and gap-fill so the chart
    # always has one row per day in the window — frontend doesn't have to.
    day_col = func.date_trunc("day", QueryRow.created_at)
    daily_rows = (
        db.query(day_col, func.count(QueryRow.id))
        .filter(QueryRow.created_at >= cutoff)
        .group_by(day_col)
        .order_by(day_col)
        .all()
    )
    by_day_count = {r[0].date().isoformat(): int(r[1]) for r in daily_rows if r[0]}
    today = datetime.now(timezone.utc).date()
    daily_inquiries: list[dict] = []
    for offset in range(days - 1, -1, -1):
        d = (today - timedelta(days=offset)).isoformat()
        daily_inquiries.append({"day": d, "count": by_day_count.get(d, 0)})

    facts = {
        "days": days,
        "total_queries": int(total_queries),
        "by_status": by_status,
        "top_equipment": top_equipment,
        "total_cost_usd": round(total_cost_usd, 4),
        "avg_duration_ms": avg_duration_ms,
        "top_errors": top_errors,
        "daily_inquiries": daily_inquiries,
        "most_active_user": most_active_user,
        "top_feedback_user": top_feedback_user,
    }

    summary_text, summary_cached = _summary_for_facts(db, facts, force_regen=force_regen)

    return {
        **facts,
        "summary": summary_text,
        "summary_cached": summary_cached,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def _facts_hash(facts: dict) -> str:
    """Hash over the *materially-changing* aggregates only. We deliberately drop
    total_cost_usd and avg_duration_ms because both drift on every call (the
    summary itself logs API cost, which would otherwise self-invalidate the cache).
    """
    keyed = {
        k: facts[k]
        for k in (
            "days",
            "total_queries",
            "by_status",
            "top_equipment",
            "top_errors",
            "daily_inquiries",
            "most_active_user",
            "top_feedback_user",
        )
    }
    blob = json.dumps(keyed, sort_keys=True, default=str).encode()
    return hashlib.sha1(blob).hexdigest()[:16]


def _summary_for_facts(db: Session, facts: dict, *, force_regen: bool) -> tuple[str | None, bool]:
    """Returns (summary_text, was_cached). Cache key is a hash of the facts so a
    new query that shifts any number forces a fresh paragraph automatically.
    """
    if facts["total_queries"] == 0:
        return None, False

    cache_key = f"admin:stats_summary:p:{_facts_hash(facts)}"
    if not force_regen:
        try:
            cached = _redis().get(cache_key)
            if cached:
                return cached, True
        except RedisError as exc:
            logger.warning("Stats paragraph cache read failed: %s", exc)

    try:
        pv = prompt_registry.get_active(db, "stat_summary")
    except prompt_registry.PromptNotFound:
        logger.info("stat_summary prompt not seeded; skipping paragraph generation")
        return None, False

    user_prompt = prompt_registry.render(
        pv.user_template,
        days=facts["days"],
        total_queries=facts["total_queries"],
        by_status=json.dumps(facts["by_status"]),
        top_equipment=json.dumps(facts["top_equipment"]),
        daily_inquiries=json.dumps(facts["daily_inquiries"]),
        avg_duration_ms=facts["avg_duration_ms"] if facts["avg_duration_ms"] is not None else "n/a",
        top_errors=json.dumps(facts["top_errors"]) if facts["top_errors"] else "none",
        most_active_user=facts["most_active_user"],
        top_feedback_user=facts["top_feedback_user"],
    )

    client = OpenRouterClient(db)
    try:
        text = client.call(
            call_type="stat_summary",
            system=pv.system_prompt,
            user=user_prompt,
            prompt_version_id=pv.id,
            max_tokens=pv.max_tokens,
            temperature=pv.temperature,
        ).strip()
    except Exception as exc:
        logger.warning("stat_summary generation failed: %s", exc)
        return None, False

    try:
        _redis().set(cache_key, text, ex=CACHE_TTL_SECONDS)
    except RedisError as exc:
        logger.warning("Stats paragraph cache write failed: %s", exc)

    return text, False
