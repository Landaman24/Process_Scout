import { useEffect, useState } from "react";

import * as admin from "../../api/admin";
import { documents, type DocumentRow } from "../../api/documents";
import { DailyInquiriesChart } from "../../components/DailyInquiriesChart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";

export function Overview() {
  const [costs, setCosts] = useState<admin.CostSummary | null>(null);
  const [containers, setContainers] = useState<admin.ContainerHealth[]>([]);
  const [queries, setQueries] = useState<admin.QueryRow[]>([]);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [statsSummary, setStatsSummary] = useState<admin.StatsSummary | null>(null);

  useEffect(() => {
    admin.costs.summary(30).then(setCosts).catch(() => {});
    admin.containers.list().then(setContainers).catch(() => {});
    admin.queries.listAll(10).then(setQueries).catch(() => {});
    documents.list().then(setDocs).catch(() => {});
    admin.stats.summary(30).then(setStatsSummary).catch(() => {});
  }, []);

  const containersUp = containers.filter((c) => c.status === "running").length;
  const totalContainers = containers.length;
  const indexedDocs = docs.filter((d) => d.ingest_status === "completed").length;
  const totalPages = docs.reduce((sum, d) => sum + d.num_pages, 0);
  const totalChunks = docs.reduce((sum, d) => sum + d.num_chunks, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Stat title="Queries (30d)" value={costs ? formatInt(costs.total_calls) : "—"} hint="Across every call type" />
        <Stat title="LLM cost (30d)" value={costs ? formatUSD(costs.total_usd) : "—"} hint="From api_usage_log" />
        <Stat
          title="Avg response time"
          value={statsSummary?.avg_duration_ms != null ? formatDuration(statsSummary.avg_duration_ms) : "—"}
          hint="Mean per query, last 30d"
        />
        <Stat
          title="Containers up"
          value={`${containersUp} / ${totalContainers || "—"}`}
          hint="Reads from the Docker socket"
        />
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Corpus
        </h2>
        <div className="grid gap-4 md:grid-cols-4">
          <Stat
            title="Documents"
            value={docs.length.toString()}
            hint={`${indexedDocs} indexed`}
          />
          <Stat title="Pages" value={formatInt(totalPages)} hint="Across all docs" />
          <Stat title="Chunks" value={formatInt(totalChunks)} hint="Searchable units" />
          <Stat title="Embedding model" value="BGE-small" hint="384-dim, local CPU" />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily inquiries (30 days)</CardTitle>
          <CardDescription>Per-day query volume across all users.</CardDescription>
        </CardHeader>
        <CardContent>
          {statsSummary ? (
            <DailyInquiriesChart data={statsSummary.daily_inquiries} height={200} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent queries</CardTitle>
            <CardDescription>Last 10, newest first</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {queries.length === 0 && <p className="text-muted-foreground">No queries yet.</p>}
            {queries.map((q) => (
              <div key={q.id} className="border rounded-md p-2 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="truncate">{q.question}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(q.created_at).toLocaleString()} · {q.duration_ms ?? "—"} ms
                  </div>
                </div>
                <StatusBadge status={q.status} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cost by call type (30d)</CardTitle>
            <CardDescription>Sorted high to low</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {!costs && <p className="text-muted-foreground">Loading…</p>}
            {costs && costs.by_call_type.length === 0 && (
              <p className="text-muted-foreground">No LLM calls yet — set OPENROUTER_API_KEY and ask something.</p>
            )}
            <div className="space-y-1">
              {costs?.by_call_type.map((row) => (
                <div key={row.call_type} className="flex justify-between border-b last:border-0 py-1">
                  <span className="font-mono text-xs">{row.call_type}</span>
                  <span>
                    {formatUSD(row.total_usd)} <span className="text-muted-foreground">({row.calls})</span>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || "bg-muted text-muted-foreground";
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${color}`}>{status}</span>;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-500/15 text-green-500",
  retrieval_only: "bg-blue-500/15 text-blue-500",
  refused: "bg-amber-500/15 text-amber-500",
  failed: "bg-red-500/15 text-red-500",
  processing: "bg-muted text-muted-foreground",
};

function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

function formatUSD(n: number): string {
  if (n < 0.01 && n > 0) return `<$0.01`;
  return `$${n.toFixed(n >= 10 ? 2 : 4)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
