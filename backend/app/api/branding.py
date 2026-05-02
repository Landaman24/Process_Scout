from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.dependencies import require_admin
from app.models.user import User
from app.schemas import BrandingPublic, BrandingUpdate
from app.services import activity_logger, branding

router = APIRouter(prefix="/api/v1/branding", tags=["branding"])

settings = get_settings()
ALLOWED_LOGO_EXT = {".png", ".jpg", ".jpeg", ".svg", ".webp"}
MAX_LOGO_BYTES = 2 * 1024 * 1024  # 2 MB


@router.get("", response_model=BrandingPublic)
def get_branding() -> dict:
    return branding.public_payload()


@router.get("/logo")
def get_logo() -> FileResponse:
    logo = branding.find_logo()
    if logo is None:
        raise HTTPException(status_code=404, detail="No logo configured")
    return FileResponse(logo)


@router.put("", response_model=BrandingPublic)
def update_branding(
    payload: BrandingUpdate,
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    branding.save({k: v for k, v in payload.model_dump().items() if v is not None})
    activity_logger.log_action(db, user_id=actor.id, action="branding_update", details=payload.model_dump())
    return branding.public_payload()


@router.post("/logo", response_model=BrandingPublic)
async def upload_logo(
    file: Annotated[UploadFile, File()],
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_LOGO_EXT:
        raise HTTPException(status_code=422, detail=f"Logo must be one of {sorted(ALLOWED_LOGO_EXT)}")

    contents = await file.read()
    if len(contents) > MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail="Logo exceeds 2 MB limit")

    branding.delete_logo()  # remove any pre-existing logo of a different extension

    logo_dir = Path(settings.BRANDING_LOGO_DIR)
    logo_dir.mkdir(parents=True, exist_ok=True)
    target = logo_dir / f"logo{suffix}"
    with target.open("wb") as f:
        f.write(contents)

    activity_logger.log_action(db, user_id=actor.id, action="branding_logo_upload", target_id=target.name)
    return branding.public_payload()


@router.delete("/logo", status_code=204)
def delete_logo(
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    if not branding.delete_logo():
        raise HTTPException(status_code=404, detail="No logo configured")
    activity_logger.log_action(db, user_id=actor.id, action="branding_logo_delete")
