import { useEffect, useState } from "react";

import * as admin from "../../api/admin";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";

const REFRESH_INTERVAL_MS = 5_000;

export function Containers() {
  const [rows, setRows] = useState<admin.ContainerHealth[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    admin.containers
      .list()
      .then((data) => {
        if (!cancelled) {
          setRows(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Container health</h2>
        <span className="text-xs text-muted-foreground">Auto-refresh every {REFRESH_INTERVAL_MS / 1000}s</span>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((c) => (
          <ContainerCard key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}

function ContainerCard({ c }: { c: admin.ContainerHealth }) {
  const dotColor = c.status === "running" ? "bg-green-500" : c.status === "exited" ? "bg-red-500" : "bg-amber-500";
  const memMB = c.memory_used_bytes != null ? Math.round(c.memory_used_bytes / 1024 / 1024) : null;
  const memLimitMB = c.memory_limit_bytes != null ? Math.round(c.memory_limit_bytes / 1024 / 1024) : null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${dotColor}`} />
            {c.name}
          </CardTitle>
          <span className="text-xs text-muted-foreground capitalize">{c.status}</span>
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-2">
        <Row label="Image" value={<span className="font-mono text-xs">{c.image || "—"}</span>} />
        <Row label="Uptime" value={formatDuration(c.uptime_seconds)} />
        <Row
          label="CPU"
          value={c.cpu_percent != null ? <Bar value={c.cpu_percent} max={100} suffix="%" /> : <span className="text-muted-foreground">—</span>}
        />
        <Row
          label="Memory"
          value={
            c.memory_percent != null && memMB != null ? (
              <div className="flex items-center gap-2">
                <Bar value={c.memory_percent} max={100} suffix="%" />
                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                  {memMB} / {memLimitMB} MB
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          }
        />
        {c.health && <Row label="Health" value={<span className="capitalize">{c.health}</span>} />}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground w-20 shrink-0">{label}</span>
      <div className="flex-1 min-w-0">{value}</div>
    </div>
  );
}

function Bar({ value, max, suffix }: { value: number; max: number; suffix: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const color = pct > 80 ? "bg-red-500" : pct > 50 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums w-12 text-right">
        {value.toFixed(1)}
        {suffix}
      </span>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
