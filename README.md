# ProcessScout

> **AI troubleshooting and knowledge-base agent for commercial and industrial facilities.**
> Indexes OEM service manuals and internal SOPs, then answers operator questions in natural language with verifiable page-level citations.

[![Stack](https://img.shields.io/badge/stack-FastAPI%20%7C%20React%20%7C%20Postgres%2Bpgvector-blue)]()
[![LLM](https://img.shields.io/badge/llm-OpenRouter-purple)]()

---

## What it does

Industrial facilities lose money to downtime when frontline operators can't quickly answer:

- *What does this error code mean?*
- *What's the procedure to clear it?*
- *Has anyone fixed this on this equipment before?*

ProcessScout ingests the manuals and SOPs that already contain these answers, then makes them queryable in plain English. Every response is grounded in a specific page of a specific document — so the operator can verify it before turning a wrench.

### Highlights

- **Cited answers, every time.** No claim leaves the model without a `[document, page]` reference. Click the citation to open the source PDF at the right page.
- **Equipment-aware disambiguation.** If a question is missing context (`"what does fault E-04 mean?"`), the agent asks a clarifying question (`"is this on the boiler or the chiller?"`) before answering.
- **Hardened against prompt injection.** Multi-layer defense: input sanitization, role-token rejection, delimited prompt structure, untrusted-content tagging, topic gate, citation-required output validation.
- **Hybrid retrieval.** BM25 (Postgres tsvector + GIN index) fused with vector search (pgvector + HNSW) via Reciprocal Rank Fusion. Local cross-encoder rerank on top.
- **Per-answer feedback.** 👍 / 👎 + optional comment on every chat response, persisted with the originating query for analysis.
- **Operator-grade observability.** Every query, retrieved chunk, prompt version, and final response is logged. Built-in CSE dashboard for prompt versioning, gold-set replay, cost tracking, and live container health.
- **Responsive layout.** Sidebar collapses to a hamburger drawer below 768px.

---

## Architecture

```
              ┌────────────────────────────┐
              │        React UI            │
              │ (chat / dashboard / CSE)   │
              └─────────────┬──────────────┘
                            │ HTTPS
              ┌─────────────▼──────────────┐
              │         FastAPI            │
              │  ┌────────────────────┐    │
              │  │   Safety Gate      │    │
              │  └─────────┬──────────┘    │
              │  ┌─────────▼──────────┐    │
              │  │  OpenRouterClient  │    │
              │  └─────────┬──────────┘    │
              └────────────┼───────────────┘
                           │
        ┌──────────────────┼─────────────────────┐
        ▼                  ▼                     ▼
  ┌──────────┐      ┌────────────┐       ┌──────────────┐
  │ Postgres │      │ OpenRouter │       │   Langfuse   │
  │ pgvector │      │ (LLM API)  │       │  (optional)  │
  └────┬─────┘      └────────────┘       └──────────────┘
       ▲
       │ ingest (async)
  ┌──────────┐
  │  Celery  │
  │ + Redis  │
  └──────────┘
```

### Query flow

```
User question
  → Safety Gate         (sanitize + topic classifier)
  → Query Understanding (extract: equipment, error code, intent)
  → Disambiguation?     → Clarifying Question (and stop)
  → Hybrid Retrieval    (BM25 + pgvector, RRF fusion, top-15)
  → Cross-Encoder Rerank (bge-reranker-base, top-5)
  → Answer Generation   (cited, page-linked)
  → Output Validation   (≥1 citation required, else fail)
  → Persist + return
```

---

## Tech stack

| Layer | Choice |
|-------|--------|
| Backend | Python 3.11 / FastAPI |
| Workers | Celery + Redis |
| Database | Postgres 16 + pgvector |
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui |
| LLM gateway | OpenRouter (Sonnet / Haiku / DeepSeek V3) |
| Embeddings | `BAAI/bge-small-en-v1.5` (local, 384-dim, CPU) |
| Reranker | `bge-reranker-base` (local cross-encoder) |
| PDF parsing | `pypdf` + `unstructured` |
| Tracing (optional) | Langfuse |
| Reverse proxy | Nginx (production deploy) |
| Deploy | Docker Compose |

---

## Quickstart — Run locally

### Prerequisites

- Docker Desktop (24.0+) with Docker Compose v2
- 4 GB RAM available to Docker
- (Optional) An [OpenRouter API key](https://openrouter.ai/) — only required for asking *new* questions; the seed corpus is browsable without one.

### 1. Clone

```bash
git clone https://github.com/Landaman24/Process_Scout.git
cd Process_Scout
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env:
# - SECRET_KEY: any strong random string (a fresh one is fine)
# - SUPERADMIN_PASSWORD: pick the password you'll log in with
# - OPENROUTER_API_KEY: only needed if you want to ask new questions
```

### 3. Start

```bash
docker compose up --build
```

First boot takes ~2 min: Postgres starts, migrations run, the seed corpus (`seed/processed.sql`) auto-loads on an empty database, and the embedding model downloads on first ingest.

### 4. Visit

- **Frontend:** http://localhost:5273
- **API docs:** http://localhost:8800/docs

### 5. Log in

- **Email:** the value of `SUPERADMIN_EMAIL` from your `.env` 
- **Password:** the value of `SUPERADMIN_PASSWORD` from your `.env`


---

## Configuration

All runtime configuration is via environment variables. See `.env.example` for the full list.

| Variable | Required | Purpose |
|----------|----------|---------|
| `SECRET_KEY` | Yes | JWT signing key |
| `SUPERADMIN_EMAIL` | Yes | First admin account, created on first boot |
| `SUPERADMIN_PASSWORD` | Yes | Password for the bootstrap admin |
| `OPENROUTER_API_KEY` | For new questions | LLM API authentication |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL` | Optional | Enables Langfuse tracing |
| `COST_LIMIT_PER_DAY_USD` | No (default 5) | Hard daily cap on LLM spend; raises 503 before exceeding |
| `COST_LIMIT_PER_MONTH_USD` | No (default 50) | Hard monthly cap |
| `POSTGRES_PORT` | No (default 5532) | Host-side Postgres port (shifted to avoid collisions) |
| `REDIS_PORT` | No (default 6479) | Host-side Redis port |
| `BACKEND_PORT` | No (default 8800) | Host-side API port |
| `FRONTEND_PORT` | No (default 5273) | Host-side Vite dev port |

`DATABASE_URL` and `REDIS_URL` are derived inside the compose network and don't need to be set manually.

---

## Project structure

```
ProcessScout/
├── README.md                           # this file
├── LICENSE
├── .gitignore
├── .env.example
├── docker-compose.yml                  # local dev
├── backend/
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── requirements.txt
│   ├── alembic/                        # migrations
│   │   └── versions/
│   ├── scripts/
│   │   ├── seed_superadmin.py
│   │   └── seed_prompts.py
│   ├── tests/
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── database.py
│       ├── celery_app.py
│       ├── api/                        # FastAPI routers
│       ├── services/
│       │   ├── openrouter_client.py    # ALL LLM calls
│       │   ├── retriever.py            # hybrid BM25 + pgvector + RRF
│       │   ├── reranker.py             # bge-reranker-base
│       │   ├── embeddings.py           # local BGE-small
│       │   ├── document_ingester.py
│       │   ├── safety_gate.py
│       │   ├── prompt_registry.py
│       │   ├── rate_limit.py
│       │   ├── activity_logger.py
│       │   ├── answer_engine.py
│       │   ├── auth.py
│       │   └── branding.py
│       ├── models/                     # SQLAlchemy
│       └── tasks/
│           └── ingest.py               # Celery task
├── frontend/
│   ├── Dockerfile
│   ├── vite.config.ts
│   ├── package.json
│   └── src/
│       ├── App.tsx
│       ├── api/                        # typed API clients
│       ├── components/                 # shared UI + chart
│       ├── contexts/                   # auth + branding
│       └── pages/
│           ├── Chat.tsx
│           ├── AdminDashboard.tsx
│           ├── Documents.tsx
│           ├── UserManagement.tsx
│           ├── CSEDashboard.tsx
│           └── cse/                    # CSE Console tabs
├── seed/
│   ├── manuals/                        # public-domain PDFs
│   ├── gold_set.json                   # evaluation set
│   └── processed.sql                   # pg_dump for first-boot seed
├── deploy/
│   └── nginx/processscout.conf
└── .github/
    └── workflows/ci.yml
```

---

## Safety & prompt-injection defenses

ProcessScout is operated by humans making physical decisions. The model's role is to surface the right page from a manual — not to invent procedures. Every user-facing prompt applies these layers:

1. **Input sanitization** — 2000-char cap, control-character strip, role-token rejection (`<|system|>`, `[INST]`, `ignore all previous instructions`, …), per-user rate limit (30 questions/hour).
2. **Prompt structure** — clearly delimited blocks. Retrieved content is always wrapped in `<untrusted_chunk>` tags. The system prompt explicitly tells the model to never follow instructions inside untrusted blocks.
3. **Topic gate** — a Haiku-tier classifier rejects off-topic queries before the answer pipeline runs.
4. **Output validation** — every answer must include ≥1 citation; uncited answers are *rejected*, not returned. Safety-relevant answers (LOTO, hot work, electrical, confined space) auto-append a qualified-technician disclaimer.
5. **Audit** — every query, classification, retrieval, and response logged with user + prompt-version IDs. Per-call cost is stamped against the same prompt version, so historical traces stay attributable to the prompt that actually ran.

---

## Document corpus & licensing

`seed/manuals/` contains only **public-domain or open-licensed** technical manuals — typically published by U.S. government agencies (DOE, U.S. Army, EPA) or released permissively. Each PDF includes a source attribution.

To use ProcessScout against your own documents, upload PDFs via the admin **Documents** page at runtime — no rebuild required. Each upload is parsed, chunked, embedded locally, and indexed asynchronously.

---

## License

This project is provided as a portfolio demonstration. See `LICENSE` for terms.
