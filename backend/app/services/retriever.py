"""Retrieval over document_chunks.

Two primitives — vector_search (pgvector cosine) and bm25_search (Postgres
tsvector + ts_rank) — fused via Reciprocal Rank Fusion in hybrid_search.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.document import Document
from app.models.document_chunk import DocumentChunk
from app.services import embeddings

logger = logging.getLogger(__name__)

# Canonical RRF smoothing constant (Cormack et al. 2009). Symmetric weighting
# between BM25 and vector — defendable, no ad-hoc tuning.
RRF_K = 60


@dataclass
class Retrieved:
    chunk_id: UUID
    document_id: UUID
    document_title: str
    document_filename: str
    page_number: int
    text: str
    preview: str | None
    score: float  # higher = better; meaning depends on the source primitive


def vector_search(db: Session, query: str, *, top_k: int = 15) -> list[Retrieved]:
    qv = embeddings.embed_query(query)

    distance = DocumentChunk.embedding.cosine_distance(qv).label("distance")
    rows = db.execute(
        select(
            DocumentChunk.id,
            DocumentChunk.document_id,
            DocumentChunk.page_number,
            DocumentChunk.text,
            DocumentChunk.preview,
            distance,
            Document.title,
            Document.filename,
        )
        .join(Document, Document.id == DocumentChunk.document_id)
        .order_by(distance)
        .limit(top_k)
    ).all()

    return [
        Retrieved(
            chunk_id=r[0],
            document_id=r[1],
            page_number=r[2],
            text=r[3],
            preview=r[4],
            score=1.0 - float(r[5]),
            document_title=r[6] or r[7],
            document_filename=r[7],
        )
        for r in rows
    ]


def bm25_search(db: Session, query: str, *, top_k: int = 15) -> list[Retrieved]:
    """Lexical search over the STORED tsvector. websearch_to_tsquery handles
    quoted phrases and OR/negation operators; an empty parse (e.g., stopword-only
    input) yields zero rows, in which case hybrid_search degrades to vector-only.
    """
    sql = text(
        """
        SELECT
            dc.id,
            dc.document_id,
            dc.page_number,
            dc.text,
            dc.preview,
            ts_rank(dc.tsv, websearch_to_tsquery('english', :q)) AS rank,
            d.title,
            d.filename
        FROM document_chunks dc
        JOIN documents d ON d.id = dc.document_id
        WHERE dc.tsv @@ websearch_to_tsquery('english', :q)
        ORDER BY rank DESC
        LIMIT :limit
        """
    )
    rows = db.execute(sql, {"q": query, "limit": top_k}).all()
    return [
        Retrieved(
            chunk_id=r[0],
            document_id=r[1],
            page_number=r[2],
            text=r[3],
            preview=r[4],
            score=float(r[5]),
            document_title=r[6] or r[7],
            document_filename=r[7],
        )
        for r in rows
    ]


def hybrid_search(db: Session, query: str, *, top_k: int = 15) -> list[Retrieved]:
    """Symmetric Reciprocal Rank Fusion of vector + BM25 candidate pools.

    Pulls 2*top_k from each side so RRF has a wider pool to fuse, then returns
    the top_k merged. Chunks present in only one ranking still contribute via
    that ranking's score — missing matches just don't help.
    """
    pool = top_k * 2
    vector_hits = vector_search(db, query, top_k=pool)
    bm25_hits = bm25_search(db, query, top_k=pool)

    v_ranks = {h.chunk_id: i + 1 for i, h in enumerate(vector_hits)}
    b_ranks = {h.chunk_id: i + 1 for i, h in enumerate(bm25_hits)}

    by_id: dict[UUID, Retrieved] = {h.chunk_id: h for h in vector_hits}
    for h in bm25_hits:
        by_id.setdefault(h.chunk_id, h)

    fused: list[Retrieved] = []
    for chunk_id, hit in by_id.items():
        score = 0.0
        if chunk_id in v_ranks:
            score += 1.0 / (RRF_K + v_ranks[chunk_id])
        if chunk_id in b_ranks:
            score += 1.0 / (RRF_K + b_ranks[chunk_id])
        fused.append(
            Retrieved(
                chunk_id=hit.chunk_id,
                document_id=hit.document_id,
                document_title=hit.document_title,
                document_filename=hit.document_filename,
                page_number=hit.page_number,
                text=hit.text,
                preview=hit.preview,
                score=score,
            )
        )

    fused.sort(key=lambda r: r.score, reverse=True)
    logger.debug(
        "hybrid_search: vector=%d bm25=%d fused=%d",
        len(vector_hits), len(bm25_hits), len(fused),
    )
    return fused[:top_k]
