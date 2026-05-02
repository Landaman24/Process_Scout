from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query as QueryParam
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, require_admin
from app.models.query import Query
from app.models.user import User
from app.schemas import ChatRequest, ChatResponse, QueryDetailOut, QueryOut
from app.services import activity_logger, answer_engine, rate_limit
from app.services.rate_limit import RateLimitExceeded
from app.services.safety_gate import SafetyViolation

router = APIRouter(prefix="/api/v1", tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
def chat(
    payload: ChatRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ChatResponse:
    try:
        rate_limit.enforce(user.id)
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=429,
            detail=str(exc),
            headers={"Retry-After": str(exc.retry_after_seconds)},
        )

    try:
        result = answer_engine.answer(
            db,
            question=payload.question,
            user_id=user.id,
            clarification_for=payload.clarification_for,
        )
    except SafetyViolation as exc:
        # Log the rejected attempt for audit even though no Query row was created.
        activity_logger.log_action(
            db,
            user_id=user.id,
            action="query_rejected",
            details={"reason": exc.reason, "question_length": len(payload.question)},
        )
        raise HTTPException(status_code=422, detail=str(exc))
    activity_logger.log_action(
        db,
        user_id=user.id,
        action="query_submitted",
        target_type="query",
        target_id=result.query_id,
        details={"status": result.status, "chunks": len(result.chunks)},
    )
    return ChatResponse(
        query_id=UUID(result.query_id),
        question=result.question,
        response=result.response,
        chunks=[
            {
                "id": UUID(c.id),
                "document_id": UUID(c.document_id),
                "document_title": c.document_title,
                "document_filename": c.document_filename,
                "page_number": c.page_number,
                "text": c.text,
                "preview": c.preview,
                "score": c.score,
                "rank": c.rank,
            }
            for c in result.chunks
        ],
        duration_ms=result.duration_ms,
        status=result.status,
        error=result.error,
    )


@router.get("/queries", response_model=list[QueryOut])
def list_queries(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, QueryParam(ge=1, le=200)] = 50,
    mine: bool = True,
) -> list[Query]:
    q = db.query(Query)
    if mine and not user.is_superadmin and user.role != "admin":
        q = q.filter(Query.user_id == user.id)
    return q.order_by(Query.created_at.desc()).limit(limit).all()


@router.get("/queries/{query_id}", response_model=QueryDetailOut)
def get_query(
    query_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Query:
    q = db.query(Query).filter(Query.id == query_id).first()
    if q is None:
        raise HTTPException(status_code=404, detail="Query not found")
    if q.user_id != user.id and user.role not in ("admin", "superadmin") and not user.is_superadmin:
        raise HTTPException(status_code=403, detail="Cannot view another user's query")
    return q


@router.get("/admin/queries", response_model=list[QueryOut])
def list_all_queries(
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, QueryParam(ge=1, le=500)] = 200,
) -> list[Query]:
    return db.query(Query).order_by(Query.created_at.desc()).limit(limit).all()
