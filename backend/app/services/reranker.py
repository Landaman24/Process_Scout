"""Cross-encoder rerank using BAAI/bge-reranker-base.

Scores (query, chunk_text) pairs and re-orders the candidate list. Lazy-loaded
singleton — model lives in the shared HF cache volume.
"""
from __future__ import annotations

import logging
import threading

from app.services.retriever import Retrieved

logger = logging.getLogger(__name__)

MODEL_NAME = "BAAI/bge-reranker-base"

_model = None
_lock = threading.Lock()


def get_model():
    global _model
    if _model is not None:
        return _model
    with _lock:
        if _model is None:
            from sentence_transformers import CrossEncoder

            logger.info("Loading reranker: %s", MODEL_NAME)
            _model = CrossEncoder(MODEL_NAME)
    return _model


def rerank(query: str, candidates: list[Retrieved], *, top_k: int = 5) -> list[Retrieved]:
    if not candidates:
        return []
    model = get_model()
    pairs = [(query, c.text) for c in candidates]
    scores = model.predict(pairs, show_progress_bar=False)
    scored = list(zip(candidates, [float(s) for s in scores]))
    scored.sort(key=lambda x: x[1], reverse=True)
    out: list[Retrieved] = []
    for cand, score in scored[:top_k]:
        cand.score = score
        out.append(cand)
    return out
