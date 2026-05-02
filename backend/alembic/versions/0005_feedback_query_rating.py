"""feedback: add query_id + rating columns for per-answer thumbs feedback

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-01

Extends the existing feedback table so a single store handles both general
issue reports (rating NULL, message + priority) and per-answer ratings
(query_id + rating set, message holds an optional comment).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "feedback",
        sa.Column(
            "query_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("queries.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("feedback", sa.Column("rating", sa.String(8), nullable=True))
    op.create_index("ix_feedback_query_id", "feedback", ["query_id"])
    op.create_index("ix_feedback_rating", "feedback", ["rating"])


def downgrade() -> None:
    op.drop_index("ix_feedback_rating", table_name="feedback")
    op.drop_index("ix_feedback_query_id", table_name="feedback")
    op.drop_column("feedback", "rating")
    op.drop_column("feedback", "query_id")
