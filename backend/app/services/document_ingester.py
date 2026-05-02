"""Document ingestion pipeline.

Stages:
  1. Hash the file (sha256) — dedup key
  2. Parse PDF → list of (page_number, text)
  3. Chunk pages — page-level granularity, sub-chunked when a page is long
  4. Metadata extraction (one LLM call per document, optional if no API key)
  5. Embed chunks via local BGE
  6. Per-chunk preview (one LLM call per chunk, optional if no API key)
  7. Persist chunks
  8. Mark document completed
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.document import Document
from app.models.document_chunk import DocumentChunk
from app.services import embeddings, prompt_registry
from app.services.openrouter_client import OpenRouterClient

logger = logging.getLogger(__name__)

CHUNK_TARGET_CHARS = 1500
CHUNK_OVERLAP_CHARS = 200
MAX_HEAD_CHARS_FOR_METADATA = 6000


class IngestionError(RuntimeError):
    pass


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(64 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_pdf(path: Path) -> list[tuple[int, str]]:
    """Return [(page_number_1_indexed, cleaned_text)]. Empty pages keep their slot."""
    reader = PdfReader(str(path))
    pages: list[tuple[int, str]] = []
    for i, page in enumerate(reader.pages, start=1):
        try:
            raw = page.extract_text() or ""
        except Exception as exc:
            logger.warning("Page %d extraction failed: %s", i, exc)
            raw = ""
        pages.append((i, _clean(raw)))
    return pages


def _clean(text: str) -> str:
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk_pages(pages: list[tuple[int, str]]) -> list[dict]:
    """Split pages into char-bounded chunks. Each chunk records its page_number.
    Long pages are sub-chunked with overlap; chunks never span page boundaries."""
    chunks: list[dict] = []
    for page_num, page_text in pages:
        if not page_text:
            continue
        if len(page_text) <= CHUNK_TARGET_CHARS:
            chunks.append({"page_number": page_num, "text": page_text})
            continue
        start = 0
        while start < len(page_text):
            end = min(start + CHUNK_TARGET_CHARS, len(page_text))
            chunks.append({"page_number": page_num, "text": page_text[start:end].strip()})
            if end >= len(page_text):
                break
            start = max(end - CHUNK_OVERLAP_CHARS, start + 1)
    return [c for c in chunks if c["text"]]


def _strip_code_fences(s: str) -> str:
    s = s.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```$", "", s)
    return s.strip()


def extract_metadata(
    client: OpenRouterClient,
    db: Session,
    *,
    title: str,
    filename: str,
    head_text: str,
) -> dict:
    pv = prompt_registry.get_active(db, "metadata_extraction")
    user = prompt_registry.render(pv.user_template, title=title, filename=filename, content=head_text)
    response = client.call(
        call_type="metadata_extraction",
        system=pv.system_prompt,
        user=user,
        prompt_version_id=pv.id,
        max_tokens=pv.max_tokens,
        temperature=pv.temperature,
    )
    cleaned = _strip_code_fences(response)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise IngestionError(f"metadata_extraction returned non-JSON: {response[:200]}") from exc


def generate_preview(
    client: OpenRouterClient,
    db: Session,
    *,
    document_title: str,
    page_number: int,
    chunk_text: str,
) -> str:
    pv = prompt_registry.get_active(db, "chunk_preview")
    user = prompt_registry.render(
        pv.user_template,
        document_title=document_title,
        page_number=page_number,
        chunk_text=chunk_text[:1500],
    )
    response = client.call(
        call_type="chunk_preview",
        system=pv.system_prompt,
        user=user,
        prompt_version_id=pv.id,
        max_tokens=pv.max_tokens,
        temperature=pv.temperature,
    )
    return response.strip().strip("\"'").strip()[:200]


def ingest(
    db: Session,
    *,
    file_path: Path,
    filename: str,
    storage_path: str,
    source_url: str | None = None,
    uploaded_by: UUID | None = None,
    use_llm: bool | None = None,
) -> Document:
    """Ingest a single PDF. Idempotent on file_hash."""
    h = file_hash(file_path)

    existing = db.query(Document).filter(Document.file_hash == h).first()
    if existing and existing.ingest_status == "completed":
        logger.info("Already ingested %s (hash=%s) — skipping", filename, h[:8])
        return existing

    if existing:
        db.query(DocumentChunk).filter(DocumentChunk.document_id == existing.id).delete()
        existing.ingest_status = "processing"
        existing.ingest_error = None
        db.commit()
        doc = existing
    else:
        doc = Document(
            filename=filename,
            title=filename.rsplit(".", 1)[0].replace("_", " "),
            source_url=source_url,
            storage_path=storage_path,
            file_hash=h,
            file_size_bytes=file_path.stat().st_size,
            uploaded_by=uploaded_by,
            ingest_status="processing",
        )
        db.add(doc)
        db.commit()
        db.refresh(doc)

    try:
        pages = parse_pdf(file_path)
        doc.num_pages = len(pages)
        chunk_dicts = chunk_pages(pages)
        if not chunk_dicts:
            raise IngestionError("No extractable text in PDF")

        use_llm_resolved = use_llm if use_llm is not None else bool(os.getenv("OPENROUTER_API_KEY"))
        client: OpenRouterClient | None = OpenRouterClient(db) if use_llm_resolved else None

        if client is not None:
            try:
                head_text = " ".join(t for _, t in pages[:8])[:MAX_HEAD_CHARS_FOR_METADATA]
                metadata = extract_metadata(
                    client, db, title=doc.title or filename, filename=filename, head_text=head_text
                )
                doc.equipment_type = (metadata.get("equipment_type") or "").strip()[:128] or None
                doc.manufacturer = (metadata.get("manufacturer") or "").strip()[:128] or None
                doc.document_section = (metadata.get("document_section") or "").strip()[:64] or None
                doc.summary = (metadata.get("summary") or "").strip() or None
            except Exception as exc:
                logger.warning("metadata_extraction failed (non-fatal): %s", exc)

        texts = [c["text"] for c in chunk_dicts]
        logger.info("Embedding %d chunks for %s", len(texts), filename)
        vectors = embeddings.embed(texts)

        # Chunk previews are network-bound (Haiku via OpenRouter). Parallelize across
        # a thread pool — each worker uses its own SessionLocal so api_usage_log writes
        # never share a session with the main ingest transaction.
        previews: list[str | None] = [None] * len(chunk_dicts)
        if client is not None:
            doc_title = doc.title or filename

            def _one_preview(payload: tuple[int, dict]) -> tuple[int, str | None]:
                idx, c = payload
                inner_db = SessionLocal()
                try:
                    inner_client = OpenRouterClient(inner_db)
                    text = generate_preview(
                        inner_client,
                        inner_db,
                        document_title=doc_title,
                        page_number=c["page_number"],
                        chunk_text=c["text"],
                    )
                    return idx, text
                except Exception as exc:
                    logger.warning("chunk_preview failed for chunk %d: %s", idx, exc)
                    return idx, None
                finally:
                    inner_db.close()

            logger.info("Generating chunk previews (parallel x8) for %d chunks", len(chunk_dicts))
            with ThreadPoolExecutor(max_workers=8) as pool:
                for idx, text in pool.map(_one_preview, list(enumerate(chunk_dicts))):
                    previews[idx] = text

        for idx, c in enumerate(chunk_dicts):
            db.add(
                DocumentChunk(
                    document_id=doc.id,
                    chunk_index=idx,
                    page_number=c["page_number"],
                    text=c["text"],
                    preview=previews[idx],
                    token_count=max(1, len(c["text"]) // 4),
                    embedding=vectors[idx],
                )
            )

        doc.num_chunks = len(chunk_dicts)
        doc.ingest_status = "completed"
        doc.completed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(doc)
        logger.info("Ingested %s — %d pages, %d chunks", filename, doc.num_pages, doc.num_chunks)
        return doc
    except Exception as exc:
        db.rollback()
        doc_row = db.query(Document).filter(Document.id == doc.id).first()
        if doc_row is not None:
            doc_row.ingest_status = "failed"
            doc_row.ingest_error = str(exc)[:2000]
            db.commit()
        logger.exception("Ingest failed for %s", filename)
        raise
