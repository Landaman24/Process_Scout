"""Per-user hourly rate limit on chat questions.

Fixed-window counter in Redis, keyed by user_id and the integer epoch hour.
30 questions/hour as called out in CLAUDE.md §3.

Fail-open: if Redis is unreachable we log and allow the request — a transient
Redis outage shouldn't take down chat for everyone. The limit is a comfort
guardrail against runaway-cost attacks, not a hard security boundary.
"""
from __future__ import annotations

import logging
import time
from uuid import UUID

import redis
from redis.exceptions import RedisError

from app.config import get_settings

logger = logging.getLogger(__name__)

LIMIT_PER_HOUR = 30
WINDOW_SECONDS = 3600

_settings = get_settings()
_client: redis.Redis | None = None


class RateLimitExceeded(Exception):
    def __init__(self, retry_after_seconds: int):
        self.retry_after_seconds = retry_after_seconds
        super().__init__(
            f"Hourly chat limit reached ({LIMIT_PER_HOUR} questions/hour). "
            f"Try again in {retry_after_seconds} seconds."
        )


def _redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(_settings.REDIS_URL, decode_responses=True)
    return _client


def enforce(user_id: UUID) -> None:
    """Increment the user's counter for the current hour; raise if over limit."""
    now = int(time.time())
    epoch_hour = now // WINDOW_SECONDS
    key = f"chat:rate:{user_id}:{epoch_hour}"
    try:
        client = _redis()
        # Atomic INCR + EXPIRE. EXPIRE re-asserts the TTL each call which is
        # harmless; simpler than checking TTL=-1 to set only on first hit.
        pipe = client.pipeline()
        pipe.incr(key)
        pipe.expire(key, WINDOW_SECONDS)
        count, _ = pipe.execute()
    except RedisError as exc:
        logger.warning("Rate-limit Redis check failed; allowing request: %s", exc)
        return
    if count > LIMIT_PER_HOUR:
        retry_after = WINDOW_SECONDS - (now % WINDOW_SECONDS)
        raise RateLimitExceeded(retry_after_seconds=retry_after)
