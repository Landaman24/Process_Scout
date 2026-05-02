"""Bootstrap a superadmin account on first boot if none exists.

Driven by SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD env vars. No-op if either is missing
or if any superadmin already exists. Per CLAUDE.md, credentials never reach the repo —
they are sent privately to invited reviewers.
"""
import logging
import os
import sys

from app.database import SessionLocal
from app.models.user import User
from app.services.auth import hash_password

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] seed_superadmin: %(message)s")
logger = logging.getLogger(__name__)


def main() -> int:
    email = os.environ.get("SUPERADMIN_EMAIL", "").strip().lower()
    password = os.environ.get("SUPERADMIN_PASSWORD", "")

    if not email or not password:
        logger.info("SUPERADMIN_EMAIL or SUPERADMIN_PASSWORD not set — skipping.")
        return 0

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.is_superadmin.is_(True)).first()
        if existing is not None:
            logger.info("Superadmin already exists (%s) — skipping seed.", existing.email)
            return 0

        if db.query(User).filter(User.email == email).first() is not None:
            logger.warning("A non-superadmin user already owns %s — skipping seed.", email)
            return 0

        user = User(
            email=email,
            full_name="Superadmin",
            role="superadmin",
            is_superadmin=True,
            is_active=True,
            hashed_password=hash_password(password),
        )
        db.add(user)
        db.commit()
        logger.info("Seeded superadmin: %s", email)
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
