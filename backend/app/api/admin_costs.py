"""Cost summary endpoint for the CSE dashboard.

Aggregates rows from api_usage_log over a rolling window — total, by call_type,
by model, by day. Demoed alongside container health and the prompt-version registry
as the headline CSE-role asset.
"""
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_admin
from app.models.api_usage_log import ApiUsageLog
from app.models.document import Document
from app.models.query import Query as QueryRow
from app.models.user import User

router = APIRouter(prefix="/api/v1/admin/costs", tags=["admin", "costs"])

# call_types behind one user-facing question (embeddings are local — not in this log).
# We can't rely on query_id alone because the early calls (safety_gate, query_understanding)
# fire before the queries row exists, so only answer_generation gets stamped.
QUERY_CALL_TYPES = ("safety_gate", "query_understanding", "clarifying_question", "answer_generation")
# call_types fired during document ingestion.
INGEST_CALL_TYPES = ("metadata_extraction", "chunk_preview")


@router.get("/summary")
def cost_summary(
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    days: Annotated[int, Query(ge=1, le=365)] = 30,
) -> dict:
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    base = (
        db.query(
            func.coalesce(func.sum(ApiUsageLog.estimated_cost_usd), 0.0),
            func.count(ApiUsageLog.id),
            func.coalesce(func.sum(ApiUsageLog.prompt_tokens), 0),
            func.coalesce(func.sum(ApiUsageLog.completion_tokens), 0),
        )
        .filter(ApiUsageLog.timestamp >= cutoff)
        .first()
    )
    total_usd, total_calls, prompt_tokens, completion_tokens = base or (0.0, 0, 0, 0)

    by_call_type = (
        db.query(
            ApiUsageLog.call_type,
            func.coalesce(func.sum(ApiUsageLog.estimated_cost_usd), 0.0),
            func.count(ApiUsageLog.id),
        )
        .filter(ApiUsageLog.timestamp >= cutoff)
        .group_by(ApiUsageLog.call_type)
        .order_by(func.coalesce(func.sum(ApiUsageLog.estimated_cost_usd), 0.0).desc())
        .all()
    )

    by_model = (
        db.query(
            ApiUsageLog.model,
            func.coalesce(func.sum(ApiUsageLog.estimated_cost_usd), 0.0),
            func.count(ApiUsageLog.id),
        )
        .filter(ApiUsageLog.timestamp >= cutoff)
        .group_by(ApiUsageLog.model)
        .order_by(func.coalesce(func.sum(ApiUsageLog.estimated_cost_usd), 0.0).desc())
        .all()
    )

    day_col = func.date_trunc("day", ApiUsageLog.timestamp)
    by_day = (
        db.query(
            day_col,
            func.coalesce(func.sum(ApiUsageLog.estimated_cost_usd), 0.0),
            func.count(ApiUsageLog.id),
        )
        .filter(ApiUsageLog.timestamp >= cutoff)
        .group_by(day_col)
        .order_by(day_col.desc())
        .all()
    )

    # Composite-action rollup: bundle the multiple LLM calls behind one user
    # action (a chat question, an upload) into one row with total / count / avg.
    # Action count comes from the source-of-truth table (queries / documents);
    # cost comes from api_usage_log filtered to that action's call_types.
    query_cost, query_calls = (
        db.query(
            func.coalesce(func.sum(ApiUsageLog.estimated_cost_usd), 0.0),
            func.count(ApiUsageLog.id),
        )
        .filter(
            ApiUsageLog.timestamp >= cutoff,
            ApiUsageLog.call_type.in_(QUERY_CALL_TYPES),
        )
        .first()
    ) or (0.0, 0)
    query_action_count = (
        db.query(func.count(QueryRow.id))
        .filter(QueryRow.created_at >= cutoff)
        .scalar()
        or 0
    )

    ingest_cost, ingest_calls = (
        db.query(
            func.coalesce(func.sum(ApiUsageLog.estimated_cost_usd), 0.0),
            func.count(ApiUsageLog.id),
        )
        .filter(
            ApiUsageLog.timestamp >= cutoff,
            ApiUsageLog.call_type.in_(INGEST_CALL_TYPES),
        )
        .first()
    ) or (0.0, 0)
    ingest_action_count = (
        db.query(func.count(Document.id))
        .filter(Document.uploaded_at >= cutoff)
        .scalar()
        or 0
    )

    by_composite = [
        {
            "key": "user_query",
            "label": "User query",
            "total_usd": float(query_cost),
            "action_count": int(query_action_count),
            "calls": int(query_calls),
            "avg_per_action_usd": (float(query_cost) / query_action_count) if query_action_count else 0.0,
        },
        {
            "key": "document_ingest",
            "label": "Document upload",
            "total_usd": float(ingest_cost),
            "action_count": int(ingest_action_count),
            "calls": int(ingest_calls),
            "avg_per_action_usd": (float(ingest_cost) / ingest_action_count) if ingest_action_count else 0.0,
        },
    ]

    return {
        "days": days,
        "total_usd": float(total_usd),
        "total_calls": int(total_calls),
        "prompt_tokens": int(prompt_tokens),
        "completion_tokens": int(completion_tokens),
        "by_call_type": [
            {"call_type": r[0], "total_usd": float(r[1]), "calls": int(r[2])} for r in by_call_type
        ],
        "by_model": [
            {"model": r[0], "total_usd": float(r[1]), "calls": int(r[2])} for r in by_model
        ],
        "by_day": [
            {"day": r[0].date().isoformat() if r[0] else None, "total_usd": float(r[1]), "calls": int(r[2])}
            for r in by_day
        ],
        "by_composite": by_composite,
    }
