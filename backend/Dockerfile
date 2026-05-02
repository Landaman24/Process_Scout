FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System deps for psycopg, bcrypt, pgvector, and the psql client used by the seed-load step.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        postgresql-client \
        curl \
    && rm -rf /var/lib/apt/lists/*

# CPU-only torch first, from PyTorch's CPU index — much smaller than the default GPU build.
# Pinned loosely; sentence-transformers will accept it.
RUN pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cpu \
        "torch>=2.2,<3"

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

RUN chmod +x entrypoint.sh && \
    mkdir -p /app/uploads/branding

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
