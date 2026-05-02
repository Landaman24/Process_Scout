"""
Single wrapper for every LLM call in ProcessScout.

Per CLAUDE.md §2: nothing imports openai/anthropic directly. Everything routes
through this client so cost logging, prompt-version stamping, hard cost limits,
and tracing stay consistent.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.api_usage_log import ApiUsageLog

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

DEFAULT_MODELS: dict[str, str] = {
    "metadata_extraction":    "anthropic/claude-haiku-4-5",
    "chunk_preview":          "anthropic/claude-haiku-4-5",
    "safety_gate":            "anthropic/claude-haiku-4-5",
    "query_understanding":    "anthropic/claude-haiku-4-5",
    "clarifying_question":    "anthropic/claude-haiku-4-5",
    "answer_generation":      "deepseek/deepseek-chat-v3",
    "stat_summary":           "anthropic/claude-sonnet-4-6",
}


class CostLimitExceeded(RuntimeError):
    def __init__(self, scope: str, spent: float, limit: float):
        self.scope = scope
        self.spent = spent
        self.limit = limit
        super().__init__(f"Cost limit exceeded ({scope}): spent ${spent:.4f} of ${limit:.2f}")


class OpenRouterClient:
    def __init__(
        self,
        db: Session,
        api_key: str | None = None,
        per_day_usd: float | None = None,
        per_month_usd: float | None = None,
    ) -> None:
        self.db = db
        self.api_key = api_key if api_key is not None else os.getenv("OPENROUTER_API_KEY", "")
        self.per_day_usd = float(
            per_day_usd if per_day_usd is not None else os.getenv("COST_LIMIT_PER_DAY_USD", "5")
        )
        self.per_month_usd = float(
            per_month_usd if per_month_usd is not None else os.getenv("COST_LIMIT_PER_MONTH_USD", "50")
        )
        self._langfuse = self._init_langfuse()

    @staticmethod
    def _init_langfuse():
        if not (os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY")):
            return None
        try:
            from langfuse import Langfuse  # type: ignore
            return Langfuse()
        except Exception as exc:
            logger.warning("Langfuse init failed: %s", exc)
            return None

    def call(
        self,
        call_type: str,
        system: str,
        user: str,
        *,
        prompt_version_id: UUID | None = None,
        user_id: UUID | None = None,
        query_id: UUID | None = None,
        model: str | None = None,
        max_tokens: int = 4096,
        temperature: float = 0.0,
    ) -> str:
        if not self.api_key:
            raise RuntimeError("OPENROUTER_API_KEY not configured")

        resolved_model = model or DEFAULT_MODELS.get(call_type)
        if not resolved_model:
            raise ValueError(
                f"Unknown call_type '{call_type}' — register it in DEFAULT_MODELS first"
            )

        self._check_cost_limits()

        trace = None
        if self._langfuse:
            trace = self._langfuse.trace(
                name=f"openrouter.{call_type}",
                input={"system": system, "user": user, "model": resolved_model},
            )

        started = time.perf_counter()
        try:
            response = httpx.post(
                OPENROUTER_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://github.com/Landaman24/Process_Scout",
                    "X-Title": "ProcessScout",
                },
                json={
                    "model": resolved_model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
                timeout=120.0,
            )
            response.raise_for_status()
            data = response.json()
        except Exception as exc:
            duration_ms = int((time.perf_counter() - started) * 1000)
            self._log(
                call_type=call_type,
                model=resolved_model,
                duration_ms=duration_ms,
                user_id=user_id,
                query_id=query_id,
                prompt_version_id=prompt_version_id,
                error=str(exc),
            )
            if trace:
                trace.update(level="ERROR", status_message=str(exc))
            raise

        duration_ms = int((time.perf_counter() - started) * 1000)
        text = data["choices"][0]["message"]["content"]
        usage = data.get("usage") or {}

        self._log(
            call_type=call_type,
            model=resolved_model,
            duration_ms=duration_ms,
            user_id=user_id,
            query_id=query_id,
            prompt_version_id=prompt_version_id,
            prompt_tokens=usage.get("prompt_tokens"),
            completion_tokens=usage.get("completion_tokens"),
            total_tokens=usage.get("total_tokens"),
            estimated_cost_usd=usage.get("cost"),
        )
        if trace:
            trace.update(
                output=text,
                usage={
                    "input": usage.get("prompt_tokens"),
                    "output": usage.get("completion_tokens"),
                    "total_cost": usage.get("cost"),
                },
            )

        return text

    def _check_cost_limits(self) -> None:
        now = datetime.now(timezone.utc)
        day_start = now - timedelta(hours=24)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        day_spent = self.db.execute(
            select(func.coalesce(func.sum(ApiUsageLog.estimated_cost_usd), 0.0))
            .where(ApiUsageLog.timestamp >= day_start)
        ).scalar_one()
        if day_spent >= self.per_day_usd:
            raise CostLimitExceeded("per_day", float(day_spent), self.per_day_usd)

        month_spent = self.db.execute(
            select(func.coalesce(func.sum(ApiUsageLog.estimated_cost_usd), 0.0))
            .where(ApiUsageLog.timestamp >= month_start)
        ).scalar_one()
        if month_spent >= self.per_month_usd:
            raise CostLimitExceeded("per_month", float(month_spent), self.per_month_usd)

    def _log(
        self,
        *,
        call_type: str,
        model: str,
        duration_ms: int,
        user_id: UUID | None = None,
        query_id: UUID | None = None,
        prompt_version_id: UUID | None = None,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        total_tokens: int | None = None,
        estimated_cost_usd: float | None = None,
        error: str | None = None,
    ) -> None:
        row = ApiUsageLog(
            user_id=user_id,
            query_id=query_id,
            prompt_version_id=prompt_version_id,
            call_type=call_type,
            model=model,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            estimated_cost_usd=estimated_cost_usd,
            duration_ms=duration_ms,
            error=error,
        )
        self.db.add(row)
        self.db.commit()
