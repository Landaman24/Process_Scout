"""Container health endpoint for the CSE dashboard.

Reads the bind-mounted Docker socket (per CLAUDE.md §3a) to surface live status,
uptime, CPU%, and memory for every container in the ProcessScout stack.

Stat collection is parallelized via ThreadPoolExecutor since `c.stats(stream=False)`
blocks for ~1.5s per container.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import require_admin
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin/containers", tags=["admin", "containers"])

CONTAINER_NAME_PREFIX = "processscout-"


def _parse_started_at(iso: str) -> int:
    """Best-effort parse of Docker's StartedAt RFC3339 string into uptime seconds."""
    if not iso:
        return 0
    try:
        # Strip nanoseconds and Z; fromisoformat handles +00:00 from 3.11.
        s = iso.replace("Z", "+00:00")
        if "." in s:
            head, tail = s.split(".", 1)
            tz_idx = max(tail.find("+"), tail.find("-"))
            tail = tail[tz_idx:] if tz_idx >= 0 else "+00:00"
            s = head + tail
        started = datetime.fromisoformat(s)
        return max(0, int((datetime.now(timezone.utc) - started).total_seconds()))
    except Exception:
        return 0


def _container_data(c) -> dict[str, Any]:
    # Read image from cached attrs instead of c.image — the latter triggers a fresh
    # API lookup that 404s (ImageNotFound) when the underlying image has been pruned
    # while the container kept running. Config.Image is the reference the container
    # was started with (tag or SHA), which is what we want to display anyway.
    image_ref = (c.attrs.get("Config") or {}).get("Image") or (c.attrs.get("Image") or "")[:19] or None
    base: dict[str, Any] = {
        "id": c.short_id,
        "name": c.name,
        "image": image_ref,
        "status": c.status,
        "health": (c.attrs.get("State") or {}).get("Health", {}).get("Status"),
        "uptime_seconds": _parse_started_at((c.attrs.get("State") or {}).get("StartedAt", "")),
    }
    try:
        stats = c.stats(stream=False)
        cpu_now = stats.get("cpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0)
        cpu_pre = stats.get("precpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0)
        sys_now = stats.get("cpu_stats", {}).get("system_cpu_usage", 0)
        sys_pre = stats.get("precpu_stats", {}).get("system_cpu_usage", 0)
        online_cpus = stats.get("cpu_stats", {}).get("online_cpus") or len(
            stats.get("cpu_stats", {}).get("cpu_usage", {}).get("percpu_usage") or []
        ) or 1
        cpu_delta = cpu_now - cpu_pre
        sys_delta = sys_now - sys_pre
        cpu_pct = (cpu_delta / sys_delta * online_cpus * 100.0) if sys_delta > 0 and cpu_delta > 0 else 0.0

        mem_used = stats.get("memory_stats", {}).get("usage", 0) or 0
        mem_limit = stats.get("memory_stats", {}).get("limit", 0) or 0
        mem_pct = (mem_used / mem_limit * 100.0) if mem_limit > 0 else 0.0

        base.update(
            {
                "cpu_percent": round(cpu_pct, 2),
                "memory_used_bytes": int(mem_used),
                "memory_limit_bytes": int(mem_limit),
                "memory_percent": round(mem_pct, 2),
            }
        )
    except Exception as exc:
        logger.warning("stats() failed for %s: %s", c.name, exc)
        base.update({"cpu_percent": None, "memory_used_bytes": None, "memory_limit_bytes": None, "memory_percent": None})

    return base


@router.get("")
def list_container_health(
    actor: Annotated[User, Depends(require_admin)],
) -> list[dict[str, Any]]:
    try:
        import docker
    except ImportError:
        raise HTTPException(status_code=500, detail="docker SDK not installed")

    try:
        client = docker.from_env()
        containers = client.containers.list(all=True, filters={"name": CONTAINER_NAME_PREFIX})
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Docker socket unreachable: {exc}")

    if not containers:
        return []

    with ThreadPoolExecutor(max_workers=min(8, len(containers))) as pool:
        results = list(pool.map(_container_data, containers))
    results.sort(key=lambda r: r.get("name", ""))
    return results
