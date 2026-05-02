import { api, tokens } from "./client";

export type QueryStatus =
  | "pending"
  | "processing"
  | "completed"
  | "retrieval_only"
  | "refused"
  | "needs_clarification"
  | "failed";

export interface ChatChunk {
  id: string;
  document_id: string;
  document_title: string;
  document_filename: string;
  page_number: number;
  text: string;
  preview: string | null;
  score: number;
  rank: number;
}

export interface ChatResponse {
  query_id: string;
  question: string;
  response: string | null;
  chunks: ChatChunk[];
  duration_ms: number;
  status: QueryStatus;
  error: string | null;
}

export function ask(question: string, clarificationFor?: string): Promise<ChatResponse> {
  return api.post<ChatResponse>("/chat", {
    question,
    clarification_for: clarificationFor,
  });
}

export function submitQueryFeedback(
  queryId: string,
  rating: "up" | "down",
  comment?: string,
): Promise<unknown> {
  return api.post(`/feedback/query/${queryId}`, { rating, comment: comment || null });
}

export interface QueryHistoryRow {
  id: string;
  user_id: string | null;
  question: string;
  response: string | null;
  status: QueryStatus;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

export function listMyQueries(limit = 5): Promise<QueryHistoryRow[]> {
  return api.get<QueryHistoryRow[]>(`/queries?mine=true&limit=${limit}`);
}

export function chunkSourceUrl(chunk: ChatChunk): string {
  // Browser PDF viewers honor #page=N to jump to the right page. The ?token=
  // fallback is needed because new-tab navigations drop the Authorization header.
  const t = tokens.access();
  const qs = t ? `?token=${encodeURIComponent(t)}` : "";
  return `/api/v1/documents/${chunk.document_id}/file${qs}#page=${chunk.page_number}`;
}
