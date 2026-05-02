from celery import Celery

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "processscout",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    # Explicit imports. Celery's autodiscover only finds files literally named
    # `tasks.py`; our task modules use descriptive names so list them here.
    imports=("app.tasks.ingest",),
)
