"""Orchestration: question → retrieve → rerank → (optional) generate cited answer.

If no OPENROUTER_API_KEY is set, the engine still runs retrieval+rerank and returns
the chunks. The frontend shows them in a "retrieval-only" state. As soon as a key is
set, the same call path produces a generated answer.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.query import Query
from app.services import prompt_registry, reranker, retriever, safety_gate
from app.services.openrouter_client import OpenRouterClient
from app.services.retriever import Retrieved
from app.services.safety_gate import SafetyViolation

logger = logging.getLogger(__name__)

VECTOR_TOP_K = 15
RERANK_TOP_K = 5
ANSWER_CALL_TYPE = "answer_generation"


@dataclass
class ChatChunk:
    id: str
    document_id: str
    document_title: str
    document_filename: str
    page_number: int
    text: str
    preview: str | None
    score: float
    rank: int


@dataclass
class ChatResult:
    query_id: str
    question: str
    response: str | None
    chunks: list[ChatChunk]
    duration_ms: int
    status: str  # "completed" | "retrieval_only" | "failed"
    error: str | None


def _format_chunks_for_prompt(chunks: list[Retrieved]) -> str:
    blocks = []
    for i, c in enumerate(chunks, start=1):
        blocks.append(
            f'<untrusted_chunk index="{i}" document="{c.document_title}" page="{c.page_number}">\n'
            f"{c.text}\n"
            f"</untrusted_chunk>"
        )
    return "\n\n".join(blocks)


def answer(
    db: Session,
    *,
    question: str,
    user_id: UUID | None = None,
    clarification_for: UUID | None = None,
) -> ChatResult:
    started = time.perf_counter()

    # Layer (a) — input sanitization. Raises SafetyViolation, caught by the API layer.
    sanitized = safety_gate.sanitize(question)
    question = sanitized.cleaned

    # Clarification follow-up: combine parent question + this clarification before retrieval.
    is_clarification = False
    if clarification_for is not None:
        parent = db.query(Query).filter(Query.id == clarification_for).first()
        if parent is not None and (user_id is None or parent.user_id == user_id):
            question = f"{parent.question} [User clarified: {question}]"
            is_clarification = True

    query_row = Query(
        user_id=user_id,
        question=question,
        status="processing",
    )
    db.add(query_row)
    db.commit()
    db.refresh(query_row)

    api_key = os.getenv("OPENROUTER_API_KEY", "")
    have_key = bool(api_key)

    # Layer (c) — topic gate. Only runs when we have a key. Off-topic short-circuits.
    if have_key:
        try:
            client_for_topic = OpenRouterClient(db)
            topic = safety_gate.classify_topic(client_for_topic, db, question)
            if topic == "off-topic":
                duration_ms = int((time.perf_counter() - started) * 1000)
                query_row.status = "refused"
                query_row.duration_ms = duration_ms
                query_row.completed_at = datetime.now(timezone.utc)
                query_row.response = safety_gate.OFF_TOPIC_MESSAGE
                query_row.retrieved_chunk_ids = []
                db.commit()
                return ChatResult(
                    query_id=str(query_row.id),
                    question=question,
                    response=safety_gate.OFF_TOPIC_MESSAGE,
                    chunks=[],
                    duration_ms=duration_ms,
                    status="refused",
                    error=None,
                )
        except Exception as exc:
            logger.warning("Topic gate failed (non-fatal, continuing): %s", exc)

        # Query understanding + disambiguation. Skipped on clarification follow-ups
        # since the user has just supplied the missing context.
        if not is_clarification:
            try:
                understanding = _extract_query_understanding(db, question)
                equipment_type = (understanding.get("equipment_type") or "").strip()
                intent = (understanding.get("intent") or "").strip().lower()
                if equipment_type:
                    query_row.equipment_context = equipment_type[:255]
                    db.commit()

                if intent == "troubleshooting" and not equipment_type:
                    clarifier = _generate_clarifier(db, question)
                    if clarifier:
                        duration_ms = int((time.perf_counter() - started) * 1000)
                        query_row.status = "needs_clarification"
                        query_row.duration_ms = duration_ms
                        query_row.completed_at = datetime.now(timezone.utc)
                        query_row.response = clarifier
                        query_row.retrieved_chunk_ids = []
                        db.commit()
                        return ChatResult(
                            query_id=str(query_row.id),
                            question=question,
                            response=clarifier,
                            chunks=[],
                            duration_ms=duration_ms,
                            status="needs_clarification",
                            error=None,
                        )
            except Exception as exc:
                logger.warning("Query understanding / clarifier failed (non-fatal): %s", exc)

    try:
        # 1. Retrieval
        candidates = retriever.hybrid_search(db, question, top_k=VECTOR_TOP_K)
        if not candidates:
            duration_ms = int((time.perf_counter() - started) * 1000)
            query_row.status = "completed"
            query_row.duration_ms = duration_ms
            query_row.completed_at = datetime.now(timezone.utc)
            query_row.retrieved_chunk_ids = []
            db.commit()
            return ChatResult(
                query_id=str(query_row.id),
                question=question,
                response="No relevant content was found in the indexed documents.",
                chunks=[],
                duration_ms=duration_ms,
                status="completed",
                error=None,
            )

        # 2. Rerank
        top = reranker.rerank(question, candidates, top_k=RERANK_TOP_K)

        chat_chunks = [
            ChatChunk(
                id=str(c.chunk_id),
                document_id=str(c.document_id),
                document_title=c.document_title,
                document_filename=c.document_filename,
                page_number=c.page_number,
                text=c.text,
                preview=c.preview,
                score=c.score,
                rank=i + 1,
            )
            for i, c in enumerate(top)
        ]
        query_row.retrieved_chunk_ids = [cc.id for cc in chat_chunks]
        db.commit()

        # 3. (Optional) generate cited answer
        if not have_key:
            duration_ms = int((time.perf_counter() - started) * 1000)
            query_row.status = "retrieval_only"
            query_row.duration_ms = duration_ms
            query_row.completed_at = datetime.now(timezone.utc)
            db.commit()
            return ChatResult(
                query_id=str(query_row.id),
                question=question,
                response=None,
                chunks=chat_chunks,
                duration_ms=duration_ms,
                status="retrieval_only",
                error=None,
            )

        try:
            pv = prompt_registry.get_active(db, ANSWER_CALL_TYPE)
        except prompt_registry.PromptNotFound as exc:
            duration_ms = int((time.perf_counter() - started) * 1000)
            query_row.status = "failed"
            query_row.error = str(exc)
            query_row.duration_ms = duration_ms
            db.commit()
            return ChatResult(
                query_id=str(query_row.id),
                question=question,
                response=None,
                chunks=chat_chunks,
                duration_ms=duration_ms,
                status="failed",
                error=str(exc),
            )

        chunks_block = _format_chunks_for_prompt(top)
        user_prompt = prompt_registry.render(
            pv.user_template,
            question=question,
            chunks=chunks_block,
        )

        client = OpenRouterClient(db)
        try:
            response_text = client.call(
                call_type=ANSWER_CALL_TYPE,
                system=pv.system_prompt,
                user=user_prompt,
                prompt_version_id=pv.id,
                user_id=user_id,
                query_id=query_row.id,
                max_tokens=pv.max_tokens,
                temperature=pv.temperature,
            )
        except Exception as exc:
            duration_ms = int((time.perf_counter() - started) * 1000)
            query_row.status = "failed"
            query_row.error = str(exc)[:2000]
            query_row.duration_ms = duration_ms
            query_row.prompt_version_id = pv.id
            db.commit()
            logger.exception("Answer generation failed")
            return ChatResult(
                query_id=str(query_row.id),
                question=question,
                response=None,
                chunks=chat_chunks,
                duration_ms=duration_ms,
                status="failed",
                error=str(exc),
            )

        # Layer (d) — output validation. A cited answer is the entire trust
        # contract; reject responses that omit citations despite chunks being
        # available rather than serve an unverified answer (CLAUDE.md §3(d)).
        is_valid, warning = safety_gate.validate_response(response_text, num_chunks=len(top))
        if not is_valid:
            duration_ms = int((time.perf_counter() - started) * 1000)
            query_row.status = "failed"
            query_row.error = (warning or "Response failed citation validation")[:2000]
            query_row.prompt_version_id = pv.id
            query_row.duration_ms = duration_ms
            query_row.completed_at = datetime.now(timezone.utc)
            db.commit()
            logger.warning("answer_generation rejected by output validator: %s", warning)
            return ChatResult(
                query_id=str(query_row.id),
                question=question,
                response=None,
                chunks=chat_chunks,
                duration_ms=duration_ms,
                status="failed",
                error=warning,
            )
        response_text = safety_gate.maybe_append_safety_disclaimer(response_text, question)

        duration_ms = int((time.perf_counter() - started) * 1000)
        query_row.response = response_text
        query_row.prompt_version_id = pv.id
        query_row.status = "completed"
        query_row.duration_ms = duration_ms
        query_row.completed_at = datetime.now(timezone.utc)
        db.commit()

        return ChatResult(
            query_id=str(query_row.id),
            question=question,
            response=response_text,
            chunks=chat_chunks,
            duration_ms=duration_ms,
            status="completed",
            error=None,
        )
    except Exception as exc:
        db.rollback()
        row = db.query(Query).filter(Query.id == query_row.id).first()
        if row is not None:
            row.status = "failed"
            row.error = str(exc)[:2000]
            db.commit()
        logger.exception("answer_engine.answer failed")
        raise


def chat_chunks_as_dict(chunks: list[ChatChunk]) -> list[dict[str, Any]]:
    return [asdict(c) for c in chunks]


def _extract_query_understanding(db: Session, question: str) -> dict:
    """Extracts equipment_type, error_code, intent from the user's question.
    Returns {} if the prompt isn't seeded or the call fails."""
    import json
    import re

    try:
        pv = prompt_registry.get_active(db, "query_understanding")
    except prompt_registry.PromptNotFound:
        return {}

    client = OpenRouterClient(db)
    response = client.call(
        call_type="query_understanding",
        system=pv.system_prompt,
        user=prompt_registry.render(pv.user_template, question=question),
        prompt_version_id=pv.id,
        max_tokens=pv.max_tokens,
        temperature=pv.temperature,
    )
    cleaned = response.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {}


def _generate_clarifier(db: Session, question: str) -> str | None:
    """Generates a single clarifying question. Returns None if not configured or fails."""
    try:
        pv = prompt_registry.get_active(db, "clarifying_question")
    except prompt_registry.PromptNotFound:
        return None

    client = OpenRouterClient(db)
    response = client.call(
        call_type="clarifying_question",
        system=pv.system_prompt,
        user=prompt_registry.render(pv.user_template, question=question),
        prompt_version_id=pv.id,
        max_tokens=pv.max_tokens,
        temperature=pv.temperature,
    )
    text = response.strip().strip("\"'`").strip()
    return text or None
