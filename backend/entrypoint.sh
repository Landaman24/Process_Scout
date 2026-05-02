#!/bin/bash
set -e

echo "[entrypoint] waiting for postgres..."
python - <<'EOF'
import os, time, sys
import psycopg
url = os.environ["DATABASE_URL"].replace("+psycopg", "")
for attempt in range(60):
    try:
        psycopg.connect(url, connect_timeout=2).close()
        print("[entrypoint] postgres ready.")
        sys.exit(0)
    except Exception as e:
        if attempt == 0:
            print(f"[entrypoint] postgres not ready yet ({e}); retrying...")
        time.sleep(1)
print("[entrypoint] postgres unreachable after 60s.")
sys.exit(1)
EOF

echo "[entrypoint] running alembic migrations..."
alembic upgrade head

echo "[entrypoint] seeding superadmin if absent..."
python -m scripts.seed_superadmin || echo "[entrypoint] superadmin seed skipped (non-fatal)"

echo "[entrypoint] seeding initial prompt versions..."
python -m scripts.seed_prompts || echo "[entrypoint] prompt seed skipped (non-fatal)"

# Auto-load the corpus dump on a fresh database. The check is "is the documents table
# empty?" — if so, this is a fresh clone and we restore the committed corpus so the demo
# is browsable without an API key.
if [ -f "/app/seed/processed.sql" ] && [ "${AUTO_SEED:-true}" = "true" ]; then
  PSQL_URL=$(echo "$DATABASE_URL" | sed 's|postgresql+psycopg|postgresql|')
  EXISTING=$(psql "$PSQL_URL" -tAc "SELECT COUNT(*) FROM documents" 2>/dev/null || echo "")
  if [ "$EXISTING" = "0" ]; then
    echo "[entrypoint] documents table empty — loading seed/processed.sql..."
    psql "$PSQL_URL" -v ON_ERROR_STOP=1 -f /app/seed/processed.sql && \
      echo "[entrypoint] seed loaded." || \
      echo "[entrypoint] seed load failed (non-fatal)"
  else
    echo "[entrypoint] documents table has $EXISTING rows — skipping seed load."
  fi
fi

# If docker-compose provides a `command:` override (e.g. the worker passes
# `celery -A app.celery_app worker ...`), exec it directly. Otherwise default
# to uvicorn so the backend container starts the API as before.
if [ "$#" -gt 0 ]; then
  echo "[entrypoint] command override: $*"
  exec "$@"
fi

RELOAD_FLAG=""
if [ "${UVICORN_RELOAD:-false}" = "true" ]; then
  RELOAD_FLAG="--reload"
fi

echo "[entrypoint] starting uvicorn..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 $RELOAD_FLAG
