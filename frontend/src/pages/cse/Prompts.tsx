import { CheckCircle2, ChevronDown, ChevronRight, Play, Plus, XCircle } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import * as admin from "../../api/admin";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";

export function Prompts() {
  const [versions, setVersions] = useState<admin.PromptVersion[]>([]);
  const [callTypes, setCallTypes] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  function load() {
    admin.prompts.list().then(setVersions).catch(() => {});
    admin.prompts.callTypes().then(setCallTypes).catch(() => {});
  }

  useEffect(() => {
    load();
  }, []);

  // Group by call_type, sort by version desc within group.
  const grouped = new Map<string, admin.PromptVersion[]>();
  for (const v of versions) {
    if (!grouped.has(v.call_type)) grouped.set(v.call_type, []);
    grouped.get(v.call_type)!.push(v);
  }
  for (const arr of grouped.values()) arr.sort((a, b) => b.version - a.version);

  return (
    <div className="space-y-6">
      <ReplayBanner />
      <div className="grid grid-cols-[280px_1fr] gap-6">
      <aside className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Call types</h2>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Plus className="h-3 w-3 mr-1" /> New
          </Button>
        </div>
        <div className="space-y-1 text-sm">
          {callTypes.map((ct) => {
            const v = grouped.get(ct);
            const active = v?.find((x) => x.is_active);
            const isSelected = selected === ct;
            return (
              <button
                key={ct}
                onClick={() => {
                  setSelected(ct);
                  setEditing(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${
                  isSelected ? "bg-accent/30 border-accent" : "hover:bg-accent/10 border-transparent"
                }`}
              >
                <div className="font-mono text-xs">{ct}</div>
                <div className="text-xs text-muted-foreground">
                  {v ? `v${active?.version || v[0].version} · ${v.length} version${v.length === 1 ? "" : "s"}` : "no versions yet"}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <main>
        {editing ? (
          <NewVersionForm
            callTypes={callTypes}
            versionsByCallType={grouped}
            initialCallType={selected}
            onCancel={() => setEditing(false)}
            onCreated={() => {
              setEditing(false);
              load();
            }}
          />
        ) : selected ? (
          <VersionsList versions={grouped.get(selected) || []} callType={selected} onCreate={() => setEditing(true)} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Prompt-version registry</CardTitle>
              <CardDescription>Select a call type from the left to inspect its versions.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                Edits never overwrite — saving creates a new row at <code>version + 1</code> and deactivates
                the previous active version. Every <code>api_usage_log</code> row is stamped with{" "}
                <code>prompt_version_id</code>, so historical traces remain attributable to the prompt that
                actually ran.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
      </div>
    </div>
  );
}

function ReplayBanner() {
  const [limit, setLimit] = useState(5);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<admin.GoldReplayResponse | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await admin.prompts.replayGoldSet(limit);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replay failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Play className="h-4 w-4" /> Gold-set replay
            </CardTitle>
            <CardDescription>
              Run gold-set questions through the currently active answer_generation prompt. Each
              question lands as a row in the inquiry log and contributes to api_usage_log — visible
              in the Inquiries and Cost-log tabs. Sequential ~10s per question.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value, 10))}
              disabled={running}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {[5, 10, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n} questions
                </option>
              ))}
            </select>
            <Button onClick={run} disabled={running} size="sm">
              {running ? "Running…" : "Run replay"}
            </Button>
          </div>
        </div>
      </CardHeader>
      {(error || result) && (
        <CardContent className="space-y-3">
          {error && (
            <div className="text-sm text-destructive border border-destructive/30 bg-destructive/10 rounded-md p-3">
              {error}
            </div>
          )}
          {result && <ReplayResultsTable result={result} />}
        </CardContent>
      )}
    </Card>
  );
}

function ReplayResultsTable({ result }: { result: admin.GoldReplayResponse }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-muted-foreground">
          {result.ran} run · {Math.round(result.total_duration_ms / 1000)}s
        </span>
        {Object.entries(result.summary).map(([status, count]) => (
          <span key={status} className="px-2 py-0.5 rounded font-medium bg-muted">
            {status}: {count}
          </span>
        ))}
      </div>
      <div className="border rounded-md overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left p-2 font-medium">ID</th>
              <th className="text-left p-2 font-medium">Category</th>
              <th className="text-left p-2 font-medium">Question</th>
              <th className="text-left p-2 font-medium">Got</th>
              <th className="text-left p-2 font-medium">Expected</th>
              <th className="text-left p-2 font-medium">Match</th>
            </tr>
          </thead>
          <tbody>
            {result.results.map((r) => {
              const expected = expectedStatusFor(r);
              const matched = expected === null ? null : matches(r.status, expected);
              return (
                <tr key={r.id || r.question} className="border-t">
                  <td className="p-2 font-mono">{r.id}</td>
                  <td className="p-2 text-muted-foreground">{r.category}</td>
                  <td className="p-2 max-w-md">
                    <div className="line-clamp-1">{r.question}</div>
                  </td>
                  <td className="p-2">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="p-2 text-muted-foreground">{expected || "—"}</td>
                  <td className="p-2">
                    {matched === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : matched ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function expectedStatusFor(r: admin.GoldReplayResult): string | null {
  if (r.expected_should_be_rejected_by_input_layer) return "rejected_input";
  if (r.expected_should_be_refused) return "refused";
  if (r.expected_clarification) return "needs_clarification";
  if (r.expected_status) return r.expected_status;
  return null;
}

function matches(actual: string, expected: string): boolean {
  return actual === expected;
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "bg-green-500/15 text-green-500",
    retrieval_only: "bg-blue-500/15 text-blue-500",
    needs_clarification: "bg-amber-500/15 text-amber-500",
    refused: "bg-amber-500/15 text-amber-500",
    rejected_input: "bg-amber-500/15 text-amber-500",
    failed: "bg-red-500/15 text-red-500",
    error: "bg-red-500/15 text-red-500",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors[status] || "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

function VersionsList({
  versions,
  callType,
  onCreate,
}: {
  versions: admin.PromptVersion[];
  callType: string;
  onCreate: () => void;
}) {
  if (versions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{callType}</CardTitle>
          <CardDescription>No versions yet for this call type.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" onClick={onCreate}>
            <Plus className="h-4 w-4 mr-1" /> Create v1
          </Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">{callType}</h2>
        <Button size="sm" onClick={onCreate}>
          <Plus className="h-4 w-4 mr-1" /> New version
        </Button>
      </div>
      {versions.map((v) => (
        <Card key={v.id} className={v.is_active ? "border-primary/50" : ""}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                v{v.version}
                {v.is_active && <span className="text-xs ml-2 px-2 py-0.5 rounded bg-primary/15 text-primary">ACTIVE</span>}
              </CardTitle>
              <span className="text-xs text-muted-foreground font-mono">{v.model}</span>
            </div>
            <CardDescription>
              {new Date(v.created_at).toLocaleString()} · temp={v.temperature} · max={v.max_tokens}
              {v.notes && ` · ${v.notes}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <PromptBlock label="System" text={v.system_prompt} />
            <PromptBlock label="User template" text={v.user_template} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PromptBlock({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <pre className="whitespace-pre-wrap font-mono text-xs bg-muted/40 rounded-md p-3 max-h-48 overflow-auto">
        {text}
      </pre>
    </div>
  );
}

function NewVersionForm({
  callTypes,
  versionsByCallType,
  initialCallType,
  onCancel,
  onCreated,
}: {
  callTypes: string[];
  versionsByCallType: Map<string, admin.PromptVersion[]>;
  initialCallType: string | null;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [callType, setCallType] = useState(initialCallType || callTypes[0] || "");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userTemplate, setUserTemplate] = useState("");
  const [model, setModel] = useState("");
  const [temperature, setTemperature] = useState("0.0");
  const [maxTokens, setMaxTokens] = useState("1500");
  const [notes, setNotes] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Preload from the active version of the chosen call type. When the user
  // switches call_type, refresh the seed values so they edit on top of what's
  // currently running, not a blank form.
  const activeForCallType = useMemo<admin.PromptVersion | undefined>(() => {
    return versionsByCallType.get(callType)?.find((v) => v.is_active);
  }, [callType, versionsByCallType]);

  useEffect(() => {
    if (!activeForCallType) {
      // No prior version — sensible defaults for a brand-new call type.
      setSystemPrompt("");
      setUserTemplate("");
      setModel("");
      setTemperature("0.0");
      setMaxTokens("1500");
      return;
    }
    setSystemPrompt(activeForCallType.system_prompt);
    setUserTemplate(activeForCallType.user_template);
    setModel(activeForCallType.model);
    setTemperature(String(activeForCallType.temperature));
    setMaxTokens(String(activeForCallType.max_tokens));
  }, [activeForCallType]);

  // Lock call_type when there's an active version — switching while editing
  // would silently swap the seeded values out from under the user.
  const callTypeLocked = !!initialCallType;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!notes.trim()) {
      setError("Please add a note describing what changed in this version.");
      return;
    }
    setSubmitting(true);
    try {
      await admin.prompts.create({
        call_type: callType,
        system_prompt: systemPrompt,
        user_template: userTemplate,
        model: model || undefined,
        temperature: parseFloat(temperature),
        max_tokens: parseInt(maxTokens, 10),
        notes: notes,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create version");
    } finally {
      setSubmitting(false);
    }
  }

  const nextVersion = activeForCallType ? activeForCallType.version + 1 : 1;
  const userTemplateVars = useMemo(() => extractVars(userTemplate), [userTemplate]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          New version of <span className="font-mono">{callType || "—"}</span>
          {activeForCallType && (
            <span className="text-sm ml-2 text-muted-foreground font-normal">
              (will be v{nextVersion}, deactivates v{activeForCallType.version})
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {activeForCallType
            ? "Most edits should be small wording changes to the system prompt. Other parameters are preloaded from the active version — only touch the Advanced section if you know you need to."
            : "First version for this call type."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4 text-sm">
          {!callTypeLocked && (
            <Field label="Call type">
              <select
                value={callType}
                onChange={(e) => setCallType(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm"
              >
                {callTypes.map((ct) => (
                  <option key={ct} value={ct}>
                    {ct}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="System prompt">
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              required
              rows={12}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
            />
          </Field>

          <Field label="Notes (required) — what changed in this version">
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. equipment-agnostic phrasing; allow more equipment classes"
            />
          </Field>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Advanced settings
              {!showAdvanced && (
                <span className="text-xs italic">
                  (model · temperature · max tokens · user template — leave alone for minor wording edits)
                </span>
              )}
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-4 border-l-2 border-amber-300/40 pl-4">
                <div className="rounded-md border border-amber-300/40 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Changing these can break the call. The user template uses Python
                  <code className="mx-1">{"{var}"}</code> formatting — variables in the
                  current template:{" "}
                  {userTemplateVars.length > 0 ? (
                    userTemplateVars.map((v) => (
                      <code key={v} className="mx-0.5 px-1 bg-white/70 rounded">
                        {v}
                      </code>
                    ))
                  ) : (
                    <em>none</em>
                  )}
                  . Renaming or removing one will produce a runtime error when the prompt fires.
                </div>

                <Field label="User template (Python {var} formatting)">
                  <textarea
                    value={userTemplate}
                    onChange={(e) => setUserTemplate(e.target.value)}
                    required
                    rows={6}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                  />
                </Field>

                <div className="grid grid-cols-3 gap-3">
                  <Field label="Model">
                    <Input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder="default from DEFAULT_MODELS"
                    />
                  </Field>
                  <Field label="Temperature (0–2)">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={temperature}
                      onChange={(e) => setTemperature(e.target.value)}
                    />
                  </Field>
                  <Field label="Max tokens">
                    <Input
                      type="number"
                      min="1"
                      max="8192"
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : `Publish v${nextVersion}`}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function extractVars(template: string): string[] {
  const re = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    seen.add(m[1]);
  }
  return Array.from(seen);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
