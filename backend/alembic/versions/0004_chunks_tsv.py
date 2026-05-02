"""document_chunks: tsvector column + GIN index for hybrid retrieval

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-30

Adds a STORED generated tsvector column derived from the chunk text using the
'english' configuration, plus a GIN index. Enables BM25-style lexical search
(via ts_rank) to combine with vector search via Reciprocal Rank Fusion.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE document_chunks "
        "ADD COLUMN tsv tsvector "
        "GENERATED ALWAYS AS (to_tsvector('english', text)) STORED"
    )
    op.execute(
        "CREATE INDEX ix_document_chunks_tsv "
        "ON document_chunks USING gin (tsv)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_tsv")
    op.execute("ALTER TABLE document_chunks DROP COLUMN IF EXISTS tsv")
