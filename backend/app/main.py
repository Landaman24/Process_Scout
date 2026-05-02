import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    activity_log,
    admin_containers,
    admin_costs,
    admin_prompts,
    admin_stats,
    auth,
    branding,
    chat,
    documents,
    feedback,
    health,
    users,
)
from app.config import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

settings = get_settings()

app = FastAPI(
    title="ProcessScout",
    description="AI troubleshooting and knowledge-base agent for industrial facilities.",
    version="0.1.0",
)

# Permissive CORS for development. Tighten for production deploy via env override.
allowed_origins = ["*"] if settings.ENVIRONMENT == "development" else []

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(branding.router)
app.include_router(documents.router)
app.include_router(chat.router)
app.include_router(admin_prompts.router)
app.include_router(admin_costs.router)
app.include_router(admin_containers.router)
app.include_router(admin_stats.router)
app.include_router(feedback.router)
app.include_router(activity_log.router)
