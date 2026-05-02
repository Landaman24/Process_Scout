from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.feedback import Feedback
from app.models.query import Query as QueryRow
from app.models.user import User
from app.schemas import FeedbackCreate, FeedbackOut, QueryFeedbackCreate
from app.services import activity_logger

router = APIRouter(prefix="/api/v1/feedback", tags=["feedback"])


@router.post("", response_model=FeedbackOut, status_code=201)
def submit_feedback(
    payload: FeedbackCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Feedback:
    row = Feedback(
        user_id=user.id,
        user_email=user.email,
        user_name=user.full_name,
        message=payload.message,
        priority=payload.priority,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    activity_logger.log_action(
        db, user_id=user.id, action="feedback_submitted", target_type="feedback",
        target_id=str(row.id), details={"priority": payload.priority},
    )
    return row


@router.post("/query/{query_id}", response_model=FeedbackOut, status_code=201)
def submit_query_feedback(
    query_id: UUID,
    payload: QueryFeedbackCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Feedback:
    """Per-answer thumbs up/down + optional comment. One row per submission;
    nothing prevents a user from submitting twice — the analytics layer can
    decide how to dedupe (latest-wins is usually right)."""
    q = db.query(QueryRow).filter(QueryRow.id == query_id).first()
    if q is None:
        raise HTTPException(status_code=404, detail="Query not found")

    row = Feedback(
        user_id=user.id,
        user_email=user.email,
        user_name=user.full_name,
        query_id=query_id,
        rating=payload.rating,
        message=payload.comment or f"(thumbs_{payload.rating})",
        priority="medium",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    activity_logger.log_action(
        db, user_id=user.id, action="query_feedback", target_type="query",
        target_id=str(query_id), details={"rating": payload.rating, "has_comment": bool(payload.comment)},
    )
    return row


@router.get("", response_model=list[FeedbackOut])
def list_feedback(
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = 100,
) -> list[Feedback]:
    return (
        db.query(Feedback)
        .order_by(Feedback.created_at.desc())
        .limit(min(max(limit, 1), 500))
        .all()
    )
