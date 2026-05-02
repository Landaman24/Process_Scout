import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  type ActivityEvent,
  type ActivityFeed,
  type ByEquipmentSummary,
  type ByUserSummary,
  stats,
  type StatsSummary,
} from "../api/admin";
import { DailyInquiriesChart } from "../components/DailyInquiriesChart";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

const STATS_WINDOW_DAYS = 7;
const BY_USER_WINDOW_DAYS = 30;
const ACTIVITY_LIMIT = 50;
const ACTIVITY_PAGE_SIZE = 10;

export function AdminDashboard() {
  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usage Dashboard</h1>
        <p className="text-muted-foreground text-base mt-1">
          Activity summary, daily volume, and the live engagement feed for the last{" "}
          {STATS_WINDOW_DAYS} days.
        </p>
      </div>

      <ActivitySummary />
      <ByEquipmentPanel />
      <ByUserPanel />
      <ActivityLog />
    </div>
  );
}

function ByEquipmentPanel() {
  const [data, setData] = useState<ByEquipmentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    stats
      .byEquipment(BY_USER_WINDOW_DAYS)
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load equipment summary"),
      );
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Inquiries by equipment</CardTitle>
        <CardDescription className="text-base">
          Distribution of questions by equipment type. Lifetime + last{" "}
          {BY_USER_WINDOW_DAYS} days.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-base text-destructive">{error}</p>}
        {!data && !error && <p className="text-base text-muted-foreground">Loading…</p>}
        {data && data.equipment.length === 0 && (
          <p className="text-base text-muted-foreground">No equipment-tagged queries yet.</p>
        )}
        {data && data.equipment.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead className="text-left text-sm uppercase text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-4 font-medium">Equipment</th>
                  <th className="py-2 pr-4 font-medium text-right">Total inquiries</th>
                  <th className="py-2 pr-4 font-medium text-right">
                    Last {BY_USER_WINDOW_DAYS} days
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.equipment.map((row, i) => (
                  <tr
                    key={row.equipment ?? `__null__${i}`}
                    className="border-b last:border-0"
                  >
                    <td className="py-2 pr-4">
                      {row.equipment ? (
                        <span className="font-medium">{row.equipment}</span>
                      ) : (
                        <span className="italic text-muted-foreground">
                          (uncategorized)
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {row.total_queries.toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {row.queries_in_window.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ByUserPanel() {
  const [data, setData] = useState<ByUserSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    stats
      .byUser(BY_USER_WINDOW_DAYS)
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load per-user summary"),
      );
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Activity summary by user</CardTitle>
        <CardDescription className="text-base">
          Lifetime inquiries, last {BY_USER_WINDOW_DAYS} days, and feedback given.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-base text-destructive">{error}</p>}
        {!data && !error && <p className="text-base text-muted-foreground">Loading…</p>}
        {data && data.users.length === 0 && (
          <p className="text-base text-muted-foreground">No user activity yet.</p>
        )}
        {data && data.users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead className="text-left text-sm uppercase text-muted-foreground border-b">
                <tr>
                  <th className="py-2 pr-4 font-medium">User</th>
                  <th className="py-2 pr-4 font-medium text-right">Total inquiries</th>
                  <th className="py-2 pr-4 font-medium text-right">
                    Last {BY_USER_WINDOW_DAYS} days
                  </th>
                  <th className="py-2 pr-4 font-medium text-right">Feedback given</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.user_id} className="border-b last:border-0">
                    <td className="py-2 pr-4">
                      <div className="font-medium">{u.user_name || u.user_email}</div>
                      {u.user_name && (
                        <div className="text-sm text-muted-foreground">{u.user_email}</div>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {u.total_queries.toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {u.queries_in_window.toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {u.feedback_count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivitySummary() {
  const [data, setData] = useState<StatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(refresh = false) {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await stats.summary(STATS_WINDOW_DAYS, refresh);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity summary");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load(false);
  }, []);

  if (loading && !data) {
    return (
      <Card>
        <CardContent className="py-6 text-base text-muted-foreground">
          Loading activity summary…
        </CardContent>
      </Card>
    );
  }
  if (error && !data) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-4 text-base text-destructive">{error}</CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const completed = data.by_status["completed"] ?? 0;
  const successRate = data.total_queries > 0 ? (completed / data.total_queries) * 100 : 0;
  const topEquipment = data.top_equipment[0]?.equipment ?? "—";

  return (
    <div className="space-y-4">
      <Card className="border-zinc-900/10 bg-zinc-50/40">
        <CardHeader className="pb-2 flex-row items-start justify-between gap-3 space-y-0">
          <div className="flex items-start gap-2">
            <Sparkles className="h-5 w-5 text-zinc-700 mt-0.5 shrink-0" />
            <div>
              <CardTitle className="text-lg">AI activity summary</CardTitle>
              <CardDescription className="text-base">
                Generated by Sonnet from the last {STATS_WINDOW_DAYS} days of queries. Cached for
                one hour.
              </CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => load(true)}
            disabled={refreshing}
            title="Force re-generate (bypasses cache)"
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Generating…" : "Refresh"}
          </Button>
        </CardHeader>
        <CardContent>
          {data.summary ? (
            <p className="text-lg leading-relaxed text-foreground">{data.summary}</p>
          ) : data.total_queries === 0 ? (
            <p className="text-base text-muted-foreground">
              No queries in the last {STATS_WINDOW_DAYS} days yet — once the chat sees traffic, a
              summary will appear here.
            </p>
          ) : (
            <p className="text-base text-muted-foreground">
              Summary generation unavailable (set <code>OPENROUTER_API_KEY</code> and confirm{" "}
              <code>stat_summary</code> is seeded).
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Total queries"
          value={data.total_queries.toLocaleString()}
          hint={`Last ${STATS_WINDOW_DAYS} days`}
        />
        <StatCard
          title="Success rate"
          value={`${successRate.toFixed(0)}%`}
          hint={`${completed} of ${data.total_queries} completed`}
        />
        <StatCard title="Top equipment" value={topEquipment} hint="Most-asked topic" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Daily inquiries</CardTitle>
          <CardDescription className="text-base">
            One bar per day for the last {STATS_WINDOW_DAYS} days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DailyInquiriesChart data={data.daily_inquiries} />
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-sm">{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function ActivityLog() {
  const [feed, setFeed] = useState<ActivityFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    stats
      .activity(STATS_WINDOW_DAYS, ACTIVITY_LIMIT)
      .then(setFeed)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load activity"),
      );
  }, []);

  const total = feed?.events.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  const pageEvents = useMemo(() => {
    if (!feed) return [];
    const start = page * ACTIVITY_PAGE_SIZE;
    return feed.events.slice(start, start + ACTIVITY_PAGE_SIZE);
  }, [feed, page]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Activity log</CardTitle>
        <CardDescription className="text-base">
          Who's asking what, and how the answers are landing.{" "}
          {total > 0
            ? `${total} event${total === 1 ? "" : "s"} in the last ${STATS_WINDOW_DAYS} days.`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {error && <p className="text-base text-destructive">{error}</p>}
        {!feed && !error && <p className="text-base text-muted-foreground">Loading…</p>}
        {feed && total === 0 && (
          <p className="text-base text-muted-foreground">Nothing yet in this window.</p>
        )}
        {pageEvents.map((e, i) => (
          <ActivityRow key={`${page}-${i}`} event={e} />
        ))}
        {total > ACTIVITY_PAGE_SIZE && (
          <div className="flex items-center justify-between pt-3 border-t">
            <div className="text-sm text-muted-foreground">
              Page {page + 1} of {pageCount}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
              >
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const when = relativeTime(event.at);
  const who = event.user_name || event.user_email || "(unknown)";

  if (event.type === "query") {
    return (
      <div className="flex items-start gap-3 border-b last:border-0 py-2">
        <MessageSquare className="h-5 w-5 text-zinc-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-base">
            <span className="font-medium">{who}</span>{" "}
            <span className="text-muted-foreground">asked:</span>{" "}
            <span className="text-foreground">{event.question}</span>
          </div>
          <div className="text-sm text-muted-foreground flex flex-wrap gap-3 mt-1">
            <span>{when}</span>
            <span>·</span>
            <span>
              status: <span className="font-medium">{event.status}</span>
            </span>
            {event.equipment_context && (
              <>
                <span>·</span>
                <span>{event.equipment_context}</span>
              </>
            )}
            {event.duration_ms != null && (
              <>
                <span>·</span>
                <span>{event.duration_ms} ms</span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Feedback event
  const Icon = event.rating === "up" ? ThumbsUp : ThumbsDown;
  const tone =
    event.rating === "up" ? "text-green-600" : "text-amber-600";
  return (
    <div className="flex items-start gap-3 border-b last:border-0 py-2">
      <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${tone}`} />
      <div className="flex-1 min-w-0">
        <div className="text-base">
          <span className="font-medium">{who}</span>{" "}
          <span className="text-muted-foreground">
            gave a thumbs-{event.rating}
            {event.comment ? ":" : "."}
          </span>{" "}
          {event.comment && <span className="italic">"{event.comment}"</span>}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{when}</div>
      </div>
    </div>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return iso;
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
