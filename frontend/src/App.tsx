import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/layout/AppShell";
import { useAuth } from "./contexts/AuthContext";
import { AdminDashboard } from "./pages/AdminDashboard";
import { Chat } from "./pages/Chat";
import { CSEDashboard } from "./pages/CSEDashboard";
import { Documents } from "./pages/Documents";
import { Login } from "./pages/Login";
import { UserManagement } from "./pages/UserManagement";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid h-screen place-items-center">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RequireRole({ children, role }: { children: JSX.Element; role: "admin" | "superadmin" }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (role === "admin" && user.role !== "admin" && user.role !== "superadmin") {
    return <Navigate to="/" replace />;
  }
  if (role === "superadmin" && user.role !== "superadmin") {
    return <Navigate to="/" replace />;
  }
  return children;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Chat />} />
        <Route
          path="admin"
          element={
            <RequireRole role="admin">
              <AdminDashboard />
            </RequireRole>
          }
        />
        <Route
          path="documents"
          element={
            <RequireRole role="admin">
              <Documents />
            </RequireRole>
          }
        />
        <Route
          path="users"
          element={
            <RequireRole role="admin">
              <UserManagement />
            </RequireRole>
          }
        />
        <Route
          path="cse"
          element={
            <RequireRole role="admin">
              <CSEDashboard />
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
