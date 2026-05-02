from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database / cache
    DATABASE_URL: str
    REDIS_URL: str = "redis://redis:6379/0"

    # Auth
    SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TTL_MINUTES: int = 60
    JWT_REFRESH_TTL_DAYS: int = 14

    # Environment
    ENVIRONMENT: str = "development"

    # LLM
    OPENROUTER_API_KEY: str = ""

    # Cost limits
    COST_LIMIT_PER_DAY_USD: float = 5.0
    COST_LIMIT_PER_MONTH_USD: float = 50.0

    # Tracing
    LANGFUSE_PUBLIC_KEY: str = ""
    LANGFUSE_SECRET_KEY: str = ""
    LANGFUSE_HOST: str = ""

    # Bootstrap superadmin
    SUPERADMIN_EMAIL: str = "admin@process-scout.com"
    SUPERADMIN_PASSWORD: str = ""

    # Branding
    BRANDING_DATA_PATH: str = "/app/app/data/branding.json"
    BRANDING_LOGO_DIR: str = "/app/uploads/branding"


@lru_cache
def get_settings() -> Settings:
    return Settings()
