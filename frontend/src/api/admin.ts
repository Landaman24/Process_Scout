import { api } from "./client";

// ---------- Prompts ----------

export interface PromptVersion {
  id: string;
  call_type: string;
  version: number;
  system_prompt: string;
  user_template: string;
  model: string;
  temperature: number;
  max_tokens: number;
  is_active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PromptVersionCreate {
  call_type: string;
  system_prompt: string;
  user_template: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  notes?: string;
}

export interface GoldReplayResult {
  id: string | null;
  category: string | null;
  question: string;
  status: string;
  duration_ms?: number;
  query_id?: string;
  chunks?: number;
  expected_status?: string;
  expected_should_be_refused?: boolean;
  expected_should_be_rejected_by_input_layer?: boolean;
  expected_clarification?: boolean;
  error?: string;
}

export interface GoldReplayResponse {
  ran: number;
  summary: Record<string, number>;
  results: GoldReplayResult[];
  total_duration_ms: number;
}

export const prompts = {
  list: () => api.get<PromptVersion[]>("/admin/prompts"),
  callTypes: () => api.get<string[]>("/admin/prompts/call-types"),
  versionsFor: (callType: string) => api.get<PromptVersion[]>(`/admin/prompts/${callType}`),
  create: (payload: PromptVersionCreate) => api.post<PromptVersion>("/admin/prompts", payload),
  replayGoldSet: (limit = 5) =>
    api.post<GoldReplayResponse>(`/admin/prompts/replay-gold-set?limit=${limit}`),
};

// ---------- Costs ----------

export interface CostSummary {
  days: number;
  total_usd: number;
  total_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  by_call_type: { call_type: string; total_usd: number; calls: number }[];
  by_model: { model: string; total_usd: number; calls: number }[];
  by_day: { day: string; total_usd: number; calls: number }[];
  by_composite: {
    key: string;
    label: string;
    total_usd: number;
    action_count: number;
    calls: number;
    avg_per_action_usd: number;
  }[];
}

export const costs = {
  summary: (days = 30) => api.get<CostSummary>(`/admin/costs/summary?days=${days}`),
};

// ---------- Containers ----------

export interface ContainerHealth {
  id: string;
  name: string;
  image: string | null;
  status: string;
  health: string | null;
  uptime_seconds: number;
  cpu_percent: number | null;
  memory_used_bytes: number | null;
  memory_limit_bytes: number | null;
  memory_percent: number | null;
}

export const containers = {
  list: () => api.get<ContainerHealth[]>("/admin/containers"),
};

// ---------- Queries (admin view) ----------

export interface QueryRow {
  id: string;
  user_id: string | null;
  question: string;
  response: string | null;
  status: "pending" | "processing" | "completed" | "retrieval_only" | "refused" | "failed";
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

export const queries = {
  listAll: (limit = 200) => api.get<QueryRow[]>(`/admin/queries?limit=${limit}`),
};

// ---------- Stats summary ----------

export interface DailyInquiry {
  day: string; // YYYY-MM-DD
  count: number;
}

export interface StatsSummary {
  days: number;
  total_queries: number;
  by_status: Record<string, number>;
  top_equipment: { equipment: string; count: number }[];
  total_cost_usd: number;
  avg_duration_ms: number | null;
  top_errors: { error: string; count: number }[];
  daily_inquiries: DailyInquiry[];
  summary: string | null;
  summary_cached: boolean;
  generated_at: string;
}

export type ActivityEvent =
  | {
      type: "query";
      at: string;
      user_email: string | null;
      user_name: string | null;
      query_id: string;
      question: string;
      status: string;
      equipment_context: string | null;
      duration_ms: number | null;
    }
  | {
      type: "feedback";
      at: string;
      user_email: string | null;
      user_name: string | null;
      query_id: string | null;
      rating: "up" | "down";
      comment: string | null;
    };

export interface ActivityFeed {
  days: number;
  events: ActivityEvent[];
}

export interface UserActivityRow {
  user_id: string;
  user_email: string | null;
  user_name: string | null;
  total_queries: number;
  queries_in_window: number;
  feedback_count: number;
}

export interface ByUserSummary {
  days: number;
  users: UserActivityRow[];
}

export interface EquipmentRow {
  equipment: string | null;
  total_queries: number;
  queries_in_window: number;
}

export interface ByEquipmentSummary {
  days: number;
  equipment: EquipmentRow[];
}

export const stats = {
  summary: (days = 7, refresh = false) =>
    api.get<StatsSummary>(`/admin/stats/summary?days=${days}${refresh ? "&refresh=true" : ""}`),
  activity: (days = 7, limit = 50) =>
    api.get<ActivityFeed>(`/admin/stats/activity?days=${days}&limit=${limit}`),
  byUser: (days = 30) => api.get<ByUserSummary>(`/admin/stats/by-user?days=${days}`),
  byEquipment: (days = 30) =>
    api.get<ByEquipmentSummary>(`/admin/stats/by-equipment?days=${days}`),
};
