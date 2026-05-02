from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

# ---------- Auth ----------

class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


# ---------- Users ----------

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10)
    full_name: str | None = None
    role: Literal["admin", "employee"] = "employee"


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: Literal["admin", "employee"] | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=10)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    # Plain str on output: email-validator 2.x rejects .local / .test / .example as
    # "special-use TLDs". Strict validation stays on INPUT (UserCreate uses EmailStr)
    # but the response model must accept whatever's already stored in the DB.
    email: str
    full_name: str | None
    role: str
    is_active: bool
    created_at: datetime


# ---------- Branding ----------

class BrandingPublic(BaseModel):
    client_name: str
    powered_by: str
    timezone: str
    has_logo: bool
    logo_url: str | None


class BrandingUpdate(BaseModel):
    client_name: str | None = None
    timezone: str | None = None


# ---------- Feedback ----------

Priority = Literal["low", "medium", "high", "urgent"]
FeedbackStatus = Literal["open", "in_progress", "resolved", "closed"]


class FeedbackCreate(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    priority: Priority = "medium"


class QueryFeedbackCreate(BaseModel):
    rating: Literal["up", "down"]
    comment: str | None = Field(default=None, max_length=2000)


class FeedbackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    user_email: str | None
    user_name: str | None
    message: str
    priority: Priority
    status: FeedbackStatus
    query_id: UUID | None = None
    rating: str | None = None


# ---------- Documents ----------

DocumentStatus = Literal["pending", "processing", "completed", "failed"]


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    filename: str
    title: str | None
    source_url: str | None
    file_size_bytes: int
    num_pages: int
    num_chunks: int
    equipment_type: str | None
    manufacturer: str | None
    document_section: str | None
    summary: str | None
    ingest_status: DocumentStatus
    ingest_error: str | None
    uploaded_at: datetime
    completed_at: datetime | None


# ---------- Chat / queries ----------

QueryStatus = Literal[
    "pending",
    "processing",
    "completed",
    "retrieval_only",
    "refused",
    "needs_clarification",
    "failed",
]


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    # If set, treats `question` as a clarification reply to the referenced query and
    # combines parent + clarification before retrieval.
    clarification_for: UUID | None = None


class ChatChunkOut(BaseModel):
    id: UUID
    document_id: UUID
    document_title: str
    document_filename: str
    page_number: int
    text: str
    preview: str | None
    score: float
    rank: int


class ChatResponse(BaseModel):
    query_id: UUID
    question: str
    response: str | None
    chunks: list[ChatChunkOut]
    duration_ms: int
    status: QueryStatus
    error: str | None


class QueryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID | None
    question: str
    response: str | None
    status: QueryStatus
    duration_ms: int | None
    created_at: datetime
    completed_at: datetime | None


class QueryDetailOut(QueryOut):
    equipment_context: str | None
    prompt_version_id: UUID | None
    retrieved_chunk_ids: list[UUID] | None
    error: str | None


# ---------- Prompt versions (admin) ----------


class PromptVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    call_type: str
    version: int
    system_prompt: str
    user_template: str
    model: str
    temperature: float
    max_tokens: int
    is_active: bool
    notes: str | None
    created_by: UUID | None
    created_at: datetime


class PromptVersionCreate(BaseModel):
    call_type: str = Field(min_length=1, max_length=64)
    system_prompt: str = Field(min_length=1)
    user_template: str = Field(min_length=1)
    model: str | None = None
    temperature: float = 0.0
    max_tokens: int = Field(default=1500, ge=1, le=8192)
    notes: str | None = None


# ---------- Activity log ----------

class ActivityLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    timestamp: datetime
    user_id: UUID | None
    action: str
    target_type: str | None
    target_id: str | None
    details: dict[str, Any] | None
