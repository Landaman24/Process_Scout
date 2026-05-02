import { createContext, ReactNode, useContext, useEffect, useState } from "react";

import { api, ApiError, tokens } from "../api/client";

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  role: "superadmin" | "admin" | "employee";
  is_active: boolean;
  created_at: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = tokens.access();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<User>("/auth/me")
      .then(setUser)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) tokens.clear();
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const form = new URLSearchParams({ username: email, password });
    const result = await api.postForm<{ access_token: string; refresh_token: string }>(
      "/auth/login",
      form,
      { auth: false },
    );
    tokens.set(result.access_token, result.refresh_token);
    const me = await api.get<User>("/auth/me");
    setUser(me);
  }

  function logout() {
    tokens.clear();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
