import { useEffect, useState } from "react";

import * as admin from "../../api/admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";

export function Costs() {
  const [data, setData] = useState<admin.CostSummary | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    admin.costs.summary(days).then(setData).catch(() => {});
  }, [days]);

  if (!data) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">Loading cost data…</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">LLM cost — last {days} days</h2>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          {[7, 14, 30, 60, 90].map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat title="Total" value={formatUSD(data.total_usd)} />
        <Stat title="Calls" value={data.total_calls.toLocaleString()} />
        <Stat title="Input tokens" value={formatTokens(data.prompt_tokens)} />
        <Stat title="Output tokens" value={formatTokens(data.completion_tokens)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By composite action</CardTitle>
          <CardDescription>One row per user-facing action — bundles every LLM call behind it</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2">
            {data.by_composite.map((row) => (
              <div key={row.key} className="rounded-md border p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">{row.label}</span>
                  <span className="text-xs text-muted-foreground">{row.calls} LLM calls</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <Metric label="Total" value={formatUSD(row.total_usd)} />
                  <Metric label="Actions" value={row.action_count.toLocaleString()} />
                  <Metric label="Avg / action" value={formatUSD(row.avg_per_action_usd)} />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <BreakdownTable
          title="By call type"
          description="Highest spend first"
          rows={data.by_call_type.map((r) => ({ key: r.call_type, label: r.call_type, calls: r.calls, usd: r.total_usd }))}
        />
        <BreakdownTable
          title="By model"
          description="Where the money went"
          rows={data.by_model.map((r) => ({ key: r.model, label: r.model, calls: r.calls, usd: r.total_usd }))}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By day</CardTitle>
          <CardDescription>Newest first</CardDescription>
        </CardHeader>
        <CardContent>
          {data.by_day.length === 0 && <p className="text-sm text-muted-foreground">No usage in the selected window.</p>}
          <div className="space-y-1">
            {data.by_day.map((r) => (
              <div key={r.day} className="flex items-center justify-between text-sm border-b last:border-0 py-1.5">
                <span className="font-mono text-xs">{r.day}</span>
                <span className="text-muted-foreground text-xs">{r.calls} calls</span>
                <span className="tabular-nums">{formatUSD(r.total_usd)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono tabular-nums">{value}</div>
    </div>
  );
}

function BreakdownTable({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: { key: string; label: string; calls: number; usd: number }[];
}) {
  const total = rows.reduce((sum, r) => sum + r.usd, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No data.</p>}
        <div className="space-y-2">
          {rows.map((r) => {
            const pct = total > 0 ? (r.usd / total) * 100 : 0;
            return (
              <div key={r.key} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs">{r.label}</span>
                  <span className="tabular-nums">
                    {formatUSD(r.usd)} <span className="text-muted-foreground">({r.calls})</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function formatUSD(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(n >= 10 ? 2 : 4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}
