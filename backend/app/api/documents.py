import shutil
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user, get_current_user_for_file, require_admin
from app.models.document import Document
from app.models.user import User
from app.schemas import DocumentOut
from app.services import activity_logger, document_ingester
from app.tasks.ingest import ingest_document_task

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])

UPLOADS_DIR = Path("/app/uploads/documents")


@router.get("", response_model=list[DocumentOut])
def list_documents(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> list[Document]:
    return db.query(Document).order_by(Document.uploaded_at.desc()).all()


@router.post("", response_model=DocumentOut, status_code=201)
async def upload_document(
    file: Annotated[UploadFile, File()],
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> Document:
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Only PDF files are supported")

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    target = UPLOADS_DIR / file.filename
    with target.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    h = document_ingester.file_hash(target)
    if db.query(Document).filter(Document.file_hash == h).first() is not None:
        target.unlink(missing_ok=True)
        raise HTTPException(status_code=409, detail="A document with identical content already exists")

    doc = Document(
        filename=file.filename,
        title=Path(file.filename).stem.replace("_", " "),
        storage_path=str(target),
        file_hash=h,
        file_size_bytes=target.stat().st_size,
        uploaded_by=actor.id,
        ingest_status="pending",
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    ingest_document_task.delay(str(doc.id))
    activity_logger.log_action(
        db,
        user_id=actor.id,
        action="document_upload",
        target_type="document",
        target_id=str(doc.id),
        details={"filename": file.filename},
    )
    return doc


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(
    document_id: UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> Document:
    doc = db.query(Document).filter(Document.id == document_id).first()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.get("/{document_id}/file")
def get_document_file(
    document_id: UUID,
    user: Annotated[User, Depends(get_current_user_for_file)],
    db: Annotated[Session, Depends(get_db)],
) -> FileResponse:
    doc = db.query(Document).filter(Document.id == document_id).first()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    # Inline so the browser PDF viewer respects #page=N anchors from citation links.
    return FileResponse(
        doc.storage_path,
        media_type="application/pdf",
        filename=doc.filename,
        content_disposition_type="inline",
    )


@router.delete("/{document_id}", status_code=204)
def delete_document(
    document_id: UUID,
    actor: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    doc = db.query(Document).filter(Document.id == document_id).first()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    storage = Path(doc.storage_path)
    # Only remove the underlying file if it lives in the uploads dir; never delete seeded corpus files.
    if storage.exists() and storage.is_file() and "/uploads/" in str(storage):
        try:
            storage.unlink()
        except OSError:
            pass

    db.delete(doc)
    db.commit()
    activity_logger.log_action(
        db, user_id=actor.id, action="document_delete", target_type="document", target_id=str(document_id)
    )
