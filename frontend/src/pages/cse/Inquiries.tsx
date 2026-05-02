import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import * as admin from "../../api/admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";

export function Inquiries() {
  const [rows, setRows] = useState<admin.QueryRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    admin.queries
      .listAll(200)
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inquiry log</CardTitle>
        <CardDescription>
          Every query, classification, retrieved chunks, and final response. The data substrate
          for LLM-as-judge grading later.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {rows.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">No queries yet. Ask something on the Troubleshooting page.</p>
        )}
        <div className="space-y-2">
          {rows.map((q) => (
            <div key={q.id} className="border rounded-md">
              <button
                onClick={() => setExpanded(expanded === q.id ? null : q.id)}
                className="w-full text-left p-3 flex items-start gap-3 hover:bg-accent/10 transition-colors"
              >
                <span className="mt-0.5">
                  {expanded === q.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{q.question}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {new Date(q.created_at).toLocaleString()} · {q.duration_ms ?? "—"} ms
                  </div>
                </div>
                <StatusBadge status={q.status} />
              </button>
              {expanded === q.id && (
                <div className="px-3 pb-3 space-y-3 text-sm border-t bg-muted/20">
                  <Field label="Question">
                    <pre className="whitespace-pre-wrap font-sans">{q.question}</pre>
                  </Field>
                  {q.response && (
                    <Field label="Response">
                      <pre className="whitespace-pre-wrap font-sans max-h-72 overflow-auto bg-background rounded p-2 border">
                        {q.response}
                      </pre>
                    </Field>
                  )}
                  {!q.response && q.status === "retrieval_only" && (
                    <Field label="Response">
                      <p className="text-xs text-muted-foreground italic">
                        retrieval_only — generation step skipped (no OPENROUTER_API_KEY at the time of this query).
                      </p>
                    </Field>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pt-2">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color: Record<string, string> = {
    completed: "bg-green-500/15 text-green-500",
    retrieval_only: "bg-blue-500/15 text-blue-500",
    refused: "bg-amber-500/15 text-amber-500",
    failed: "bg-red-500/15 text-red-500",
    processing: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${color[status] || "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}
