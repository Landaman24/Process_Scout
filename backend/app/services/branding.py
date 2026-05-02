import json
import os
from pathlib import Path

from app.config import get_settings

settings = get_settings()


DEFAULT_BRANDING = {
    "client_name": "ProcessScout",
    "powered_by": "ProcessScout",
    "timezone": "America/Chicago",
}

LOGO_EXTENSIONS = (".png", ".jpg", ".jpeg", ".svg", ".webp")


def _data_path() -> Path:
    return Path(settings.BRANDING_DATA_PATH)


def _logo_dir() -> Path:
    return Path(settings.BRANDING_LOGO_DIR)


def load() -> dict:
    path = _data_path()
    if not path.exists():
        return dict(DEFAULT_BRANDING)
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return dict(DEFAULT_BRANDING)
    return {**DEFAULT_BRANDING, **data}


def save(payload: dict) -> dict:
    merged = {**load(), **{k: v for k, v in payload.items() if v is not None}}
    path = _data_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2)
    return merged


def find_logo() -> Path | None:
    logo_dir = _logo_dir()
    if not logo_dir.exists():
        return None
    for ext in LOGO_EXTENSIONS:
        candidate = logo_dir / f"logo{ext}"
        if candidate.exists():
            return candidate
    return None


def delete_logo() -> bool:
    logo = find_logo()
    if logo is None:
        return False
    os.remove(logo)
    return True


def public_payload() -> dict:
    base = load()
    logo = find_logo()
    return {
        **base,
        "has_logo": logo is not None,
        "logo_url": "/api/v1/branding/logo" if logo else None,
    }
