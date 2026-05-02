import { api, tokens } from "./client";

export type DocumentStatus = "pending" | "processing" | "completed" | "failed";

export interface DocumentRow {
  id: string;
  filename: string;
  title: string | null;
  source_url: string | null;
  file_size_bytes: number;
  num_pages: number;
  num_chunks: number;
  equipment_type: string | null;
  manufacturer: string | null;
  document_section: string | null;
  summary: string | null;
  ingest_status: DocumentStatus;
  ingest_error: string | null;
  uploaded_at: string;
  completed_at: string | null;
}

export const documents = {
  list: () => api.get<DocumentRow[]>("/documents"),

  get: (id: string) => api.get<DocumentRow>(`/documents/${id}`),

  delete: (id: string) => api.delete<void>(`/documents/${id}`),

  // Upload uses raw fetch because our api wrapper is JSON-first; FormData needs no Content-Type.
  upload: async (file: File): Promise<DocumentRow> => {
    const form = new FormData();
    form.append("file", file);
    const headers = new Headers();
    const token = tokens.access();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const res = await fetch("/api/v1/documents", {
      method: "POST",
      headers,
      body: form,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const detail = data?.detail || res.statusText || "Upload failed";
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return data as DocumentRow;
  },

  // Browser navigations to /file open in a new tab and don't carry the
  // Authorization header — we append the access token as ?token= so the
  // request still authenticates. The hash (#page=N) must come last so the
  // PDF viewer honors it.
  fileUrl: (id: string, page?: number) => {
    const t = tokens.access();
    const qs = t ? `?token=${encodeURIComponent(t)}` : "";
    const hash = page ? `#page=${page}` : "";
    return `/api/v1/documents/${id}/file${qs}${hash}`;
  },
};
