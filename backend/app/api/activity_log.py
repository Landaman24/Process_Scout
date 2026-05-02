from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_admin
from app.models.activity_log import ActivityLog
from app.models.user import User
from app.schemas import ActivityLogOut

router = APIRouter(prefix="/api/v1/activity-log", tags=["activity-log"])


@router.get("", response_model=list[ActivityLogOut])
def list_activity(
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    action: str | None = None,
) -> list[ActivityLog]:
    query = db.query(ActivityLog).order_by(ActivityLog.timestamp.desc())
    if action:
        query = query.filter(ActivityLog.action == action)
    return query.limit(limit).all()
