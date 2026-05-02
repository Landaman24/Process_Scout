"""Local sentence-transformers embeddings.

Model: BAAI/bge-small-en-v1.5 — 384-dim, ~130MB, fast on CPU.
Lazy-loaded singleton; the model is cached under /root/.cache/huggingface
which is mounted as a Docker volume so a fresh container reuses prior downloads.
"""
from __future__ import annotations

import logging
import threading

logger = logging.getLogger(__name__)

MODEL_NAME = "BAAI/bge-small-en-v1.5"
EMBEDDING_DIM = 384

_model = None
_lock = threading.Lock()


def get_model():
    global _model
    if _model is not None:
        return _model
    with _lock:
        if _model is None:
            from sentence_transformers import SentenceTransformer

            logger.info("Loading embedding model: %s", MODEL_NAME)
            _model = SentenceTransformer(MODEL_NAME)
    return _model


def embed(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    model = get_model()
    vectors = model.encode(
        texts,
        normalize_embeddings=True,
        show_progress_bar=False,
        batch_size=16,
    )
    return [v.tolist() for v in vectors]


def embed_query(text: str) -> list[float]:
    return embed([text])[0]
