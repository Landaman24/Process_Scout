from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_admin
from app.models.user import User
from app.schemas import UserCreate, UserOut, UserUpdate
from app.services import activity_logger
from app.services.auth import hash_password, validate_password_policy

router = APIRouter(prefix="/api/v1/users", tags=["users"])


def _hidden_query(db: Session):
    """All listing/lookup queries hide superadmin accounts from the client view per CLAUDE.md §7."""
    return db.query(User).filter(User.is_superadmin.is_(False))


@router.get("", response_model=list[UserOut])
def list_users(
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> list[User]:
    return _hidden_query(db).order_by(User.created_at.desc()).all()


@router.post("", response_model=UserOut, status_code=201)
def create_user(
    payload: UserCreate,
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    try:
        validate_password_policy(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    email = payload.email.lower()
    if db.query(User).filter(User.email == email).first() is not None:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=email,
        full_name=payload.full_name,
        role=payload.role,
        hashed_password=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    activity_logger.log_action(
        db, user_id=actor.id, action="user_create", target_type="user", target_id=str(user.id)
    )
    return user


@router.get("/{user_id}", response_model=UserOut)
def get_user(
    user_id: UUID,
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    user = _hidden_query(db).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: UUID,
    payload: UserUpdate,
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    user = _hidden_query(db).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.password is not None:
        try:
            validate_password_policy(payload.password)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        user.hashed_password = hash_password(payload.password)
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active

    db.commit()
    db.refresh(user)
    activity_logger.log_action(
        db, user_id=actor.id, action="user_update", target_type="user", target_id=str(user.id)
    )
    return user


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: UUID,
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    user = _hidden_query(db).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.is_superadmin:
        # Defense in depth — _hidden_query already filters these, but never let a superadmin be deleted.
        raise HTTPException(status_code=403, detail="Cannot delete this user")
    db.delete(user)
    db.commit()
    activity_logger.log_action(
        db, user_id=actor.id, action="user_delete", target_type="user", target_id=str(user_id)
    )
