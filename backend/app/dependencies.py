from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.user import User

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def _resolve_user(token: str, db: Session) -> User:
    creds_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise creds_exc
    except JWTError:
        raise creds_exc

    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        raise creds_exc
    return user


def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    return _resolve_user(token, db)


def get_current_user_for_file(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    token: str | None = None,
) -> User:
    """Auth path used by routes that browsers navigate to in a new tab — the
    Authorization header is dropped on `<a target="_blank">` clicks, so we
    accept the access token via `?token=` as a fallback. The token still has
    its normal short TTL and only opens read-only file responses.
    """
    auth = request.headers.get("authorization", "")
    bearer = auth[7:].strip() if auth.lower().startswith("bearer ") else None
    resolved = bearer or token
    if not resolved:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _resolve_user(resolved, db)


def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role not in ("admin", "superadmin") and not user.is_superadmin:
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


def require_superadmin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if not user.is_superadmin:
        raise HTTPException(status_code=403, detail="Superadmin role required")
    return user
