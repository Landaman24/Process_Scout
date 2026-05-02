import logging
from pathlib import Path
from uuid import UUID

from app.celery_app import celery_app
from app.database import SessionLocal
from app.models.document import Document
from app.services import document_ingester

logger = logging.getLogger(__name__)


@celery_app.task(name="ingest_document", bind=True)
def ingest_document_task(self, document_id: str) -> dict:
    db = SessionLocal()
    try:
        doc = db.query(Document).filter(Document.id == UUID(document_id)).first()
        if doc is None:
            return {"status": "error", "error": "document_not_found", "document_id": document_id}

        path = Path(doc.storage_path)
        if not path.exists():
            doc.ingest_status = "failed"
            doc.ingest_error = f"file not found at {doc.storage_path}"
            db.commit()
            return {"status": "failed", "error": "file_not_found"}

        try:
            document_ingester.ingest(
                db,
                file_path=path,
                filename=doc.filename,
                storage_path=doc.storage_path,
                source_url=doc.source_url,
                uploaded_by=doc.uploaded_by,
            )
            return {"status": "completed", "document_id": str(doc.id)}
        except Exception as exc:
            return {"status": "failed", "error": str(exc)}
    finally:
        db.close()
