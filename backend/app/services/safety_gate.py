"""Safety gate — five layers of defense against prompt injection and unsafe responses.

Layer (a) — input sanitization: length cap, control-char strip, role-token rejection
Layer (b) — prompt structure: lives in answer_engine where retrieved chunks are wrapped
            in <untrusted_chunk> tags
Layer (c) — topic gate: Haiku classifier rejects off-topic queries before retrieval runs
Layer (d) — output validation: citation requirement, safety disclaimer auto-append
Layer (e) — audit: lives in the queries table (every query, retrieved_chunk_ids, response,
            prompt_version_id are persisted)
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.services import prompt_registry
from app.services.openrouter_client import OpenRouterClient

logger = logging.getLogger(__name__)

MAX_INPUT_CHARS = 2000

# Patterns that indicate a likely prompt-injection attempt. Case-insensitive.
ROLEPLAY_PATTERNS = [
    r"<\|\s*system\s*\|>",
    r"<\|\s*user\s*\|>",
    r"<\|\s*assistant\s*\|>",
    r"\[\s*SYSTEM\s*\]",
    r"\[\s*INST\s*\]",
    r"###\s*(?:system|instruction|user|assistant)\b",
    r"</?system\b",
    r"</?assistant\b",
    r"\bignore\s+(?:all\s+)?(?:previous|prior|the above|above)\s+(?:instructions?|prompts?|rules?|context)\b",
    r"\bdisregard\s+(?:all\s+)?(?:previous|prior|the above|above)\b",
    r"\bforget\s+(?:everything|all|previous)\b",
    r"\byou\s+are\s+now\s+a\b",
    r"\bact\s+as\s+(?:a\s+)?(?:dan|jailbreak|developer|admin|root|god)\b",
]

# Hazardous-procedure keywords. If question or response touches these, append a safety
# disclaimer to the answer (unless the model already wrote one).
SAFETY_KEYWORDS = (
    "lockout", "tagout", "loto",
    "hot work", "high voltage", "energized",
    "confined space",
    "hazardous", "explosive", "ignition source",
    "live circuit", "electrical hazard",
)

SAFETY_DISCLAIMER = (
    "Always follow your facility's lockout-tagout and safety procedures. "
    "Consult a qualified technician if uncertain."
)

OFF_TOPIC_MESSAGE = (
    "I can only answer questions about troubleshooting, operating, or maintaining the industrial "
    "and commercial equipment covered by the indexed documents (compressors, pumps, generators, "
    "VFDs, soft starts, related motor-control systems). Please rephrase your question to focus on "
    "one of those topics."
)

VALID_TOPICS = {"troubleshooting", "safety", "general", "off-topic"}

TOPIC_GATE_CALL_TYPE = "safety_gate"


class SafetyViolation(ValueError):
    """Raised when input fails sanitization. The .reason field is short and stable
    (suitable for client display); the message is more descriptive."""

    def __init__(self, reason: str, message: str):
        self.reason = reason
        super().__init__(message)


@dataclass
class SanitizedQuestion:
    cleaned: str


def sanitize(question: str) -> SanitizedQuestion:
    """Layer (a). Deterministic, no LLM. Raises SafetyViolation on rejection."""
    if not question or not question.strip():
        raise SafetyViolation("empty", "Question must not be empty")

    if len(question) > MAX_INPUT_CHARS:
        raise SafetyViolation(
            "too_long",
            f"Question exceeds the {MAX_INPUT_CHARS}-character limit",
        )

    # Strip zero-width and bidi-override Unicode chars commonly used to smuggle payloads.
    cleaned = re.sub(r"[​-‏﻿‪-‮]", "", question)
    # Strip control characters except common whitespace (\t \n \r).
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", cleaned)
    cleaned = cleaned.strip()

    if not cleaned:
        raise SafetyViolation("empty", "Question is empty after sanitization")

    for pat in ROLEPLAY_PATTERNS:
        if re.search(pat, cleaned, re.IGNORECASE):
            raise SafetyViolation(
                "injection_pattern",
                "Input rejected — contains pattern resembling a prompt-injection attempt",
            )

    return SanitizedQuestion(cleaned=cleaned)


def classify_topic(client: OpenRouterClient, db: Session, question: str) -> str:
    """Layer (c). Returns one of VALID_TOPICS. Defaults to 'off-topic' on parse failure
    (fail-safe — better to refuse than to leak)."""
    try:
        pv = prompt_registry.get_active(db, TOPIC_GATE_CALL_TYPE)
    except prompt_registry.PromptNotFound:
        logger.warning("safety_gate prompt not seeded — skipping topic classification")
        return "general"

    user = prompt_registry.render(pv.user_template, question=question)
    response = client.call(
        call_type=TOPIC_GATE_CALL_TYPE,
        system=pv.system_prompt,
        user=user,
        prompt_version_id=pv.id,
        max_tokens=pv.max_tokens,
        temperature=pv.temperature,
    )
    cleaned = response.strip().lower().split("\n")[0].split()[0] if response.strip() else ""
    cleaned = cleaned.strip(".,!?:;\"'`")
    return cleaned if cleaned in VALID_TOPICS else "off-topic"


def validate_response(response: str, num_chunks: int) -> tuple[bool, str | None]:
    """Layer (d). Returns (is_valid, warning_message). Caller (answer_engine)
    treats `not is_valid` as a hard reject when chunks were retrieved."""
    if num_chunks == 0:
        return True, None
    citations = re.findall(r"\[\d+\]", response)
    if not citations:
        return False, "Response did not cite any source chunks"
    return True, None


def maybe_append_safety_disclaimer(response: str, question: str) -> str:
    """Layer (d). Append the qualified-technician disclaimer when the question or response
    references hazardous-procedure topics, unless the model already wrote one."""
    haystack = f"{question}\n{response}".lower()
    if not any(kw in haystack for kw in SAFETY_KEYWORDS):
        return response
    if "qualified technician" in response.lower():
        return response
    return response.rstrip() + "\n\n" + SAFETY_DISCLAIMER
