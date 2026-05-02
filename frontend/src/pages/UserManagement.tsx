import { Trash2, UserPlus } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import {
  type UserCreatePayload,
  type UserRole,
  type UserRow,
  users,
} from "../api/users";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useAuth } from "../contexts/AuthContext";

export function UserManagement() {
  const { user: actor } = useAuth();
  const [list, setList] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      const rows = await users.list();
      setList(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(payload: UserCreatePayload) {
    await users.create(payload);
    await load();
  }

  async function handleRoleChange(u: UserRow, role: UserRole) {
    const updated = await users.update(u.id, { role });
    setList((prev) => prev.map((row) => (row.id === u.id ? updated : row)));
  }

  async function handleActiveToggle(u: UserRow) {
    const updated = await users.update(u.id, { is_active: !u.is_active });
    setList((prev) => prev.map((row) => (row.id === u.id ? updated : row)));
  }

  async function handleDelete(u: UserRow) {
    if (!confirm(`Delete ${u.email}? This cannot be undone.`)) return;
    try {
      await users.delete(u.id);
      setList((prev) => prev.filter((row) => row.id !== u.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-muted-foreground text-base mt-1">
          Manage employee and admin accounts. Superadmin accounts are hidden by design.
        </p>
      </div>

      <AddUserForm onSubmit={handleCreate} />

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            {loading ? "Loading…" : `${list.length} user${list.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? null : list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet — add one above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Email</th>
                    <th className="py-2 pr-4 font-medium">Name</th>
                    <th className="py-2 pr-4 font-medium">Role</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Created</th>
                    <th className="py-2 pr-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((u) => (
                    <tr key={u.id} className="border-b last:border-b-0 hover:bg-accent/30">
                      <td className="py-2 pr-4 font-medium">{u.email}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {u.full_name || <span className="italic">—</span>}
                      </td>
                      <td className="py-2 pr-4">
                        <RoleSelect
                          value={u.role}
                          onChange={(role) => handleRoleChange(u, role)}
                          disabled={u.id === actor?.id}
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          onClick={() => handleActiveToggle(u)}
                          disabled={u.id === actor?.id}
                          className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
                            u.is_active
                              ? "bg-green-500/15 text-green-600 hover:bg-green-500/25"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          } ${u.id === actor?.id ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                          title={u.id === actor?.id ? "Can't deactivate yourself" : "Click to toggle"}
                        >
                          {u.is_active ? "active" : "inactive"}
                        </button>
                      </td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <button
                          onClick={() => handleDelete(u)}
                          disabled={u.id === actor?.id}
                          className="text-muted-foreground hover:text-destructive p-1.5 rounded hover:bg-destructive/10 disabled:opacity-30 disabled:cursor-not-allowed"
                          title={u.id === actor?.id ? "Can't delete yourself" : "Delete user"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (role: UserRole) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as UserRole)}
      disabled={disabled}
      className="h-7 rounded border border-input bg-background px-2 text-xs disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <option value="employee">employee</option>
      <option value="admin">admin</option>
    </select>
  );
}

function AddUserForm({ onSubmit }: { onSubmit: (p: UserCreatePayload) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>("employee");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handle(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (password.length < 10) {
      setFormError("Password must be at least 10 characters.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        email: email.trim().toLowerCase(),
        password,
        full_name: fullName.trim() || undefined,
        role,
      });
      setEmail("");
      setPassword("");
      setFullName("");
      setRole("employee");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="h-4 w-4" /> Add user
        </CardTitle>
        <CardDescription>
          Password must be at least 10 characters. The user can change it after first login.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handle} className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto_auto] md:items-end">
          <Field label="Email">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </Field>
          <Field label="Full name (optional)">
            <Input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Operator"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="≥ 10 chars"
            />
          </Field>
          <Field label="Role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="employee">employee</option>
              <option value="admin">admin</option>
            </select>
          </Field>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create"}
          </Button>
        </form>
        {formError && <p className="text-xs text-destructive mt-3">{formError}</p>}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 block">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
