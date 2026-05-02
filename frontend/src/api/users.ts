import { api } from "./client";

export type UserRole = "admin" | "employee";

export interface UserRow {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface UserCreatePayload {
  email: string;
  password: string;
  full_name?: string;
  role: UserRole;
}

export interface UserUpdatePayload {
  full_name?: string | null;
  role?: UserRole;
  is_active?: boolean;
  password?: string;
}

export const users = {
  list: () => api.get<UserRow[]>("/users"),
  create: (payload: UserCreatePayload) => api.post<UserRow>("/users", payload),
  update: (id: string, payload: UserUpdatePayload) =>
    api.patch<UserRow>(`/users/${id}`, payload),
  delete: (id: string) => api.delete<void>(`/users/${id}`),
};
