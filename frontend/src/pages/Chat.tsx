import {
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  HelpCircle,
  Send,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import {
  ask,
  type ChatChunk,
  chunkSourceUrl,
  type ChatResponse,
  listMyQueries,
  type QueryHistoryRow,
  submitQueryFeedback,
} from "../api/chat";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";

interface Turn {
  question: string;
  result: ChatResponse | null;
  loading: boolean;
  error: string | null;
  errorStatus: number | null;
  isClarification: boolean;
}

export function Chat() {
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // When set, the next user message is treated as a clarification of the named query.
  const [pendingClarificationFor, setPendingClarificationFor] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const question = draft.trim();
    if (!question || submitting) return;
    setDraft("");
    setSubmitting(true);

    const isClarification = pendingClarificationFor !== null;
    const turnIndex = turns.length;
    setTurns((prev) => [
      ...prev,
      { question, result: null, loading: true, error: null, errorStatus: null, isClarification },
    ]);

    try {
      const result = await ask(question, pendingClarificationFor ?? undefined);
      setTurns((prev) =>
        prev.map((t, i) => (i === turnIndex ? { ...t, result, loading: false } : t)),
      );
      // If the agent asked for clarification, lock the next reply onto this query_id.
      if (result.status === "needs_clarification") {
        setPendingClarificationFor(result.query_id);
      } else {
        setPendingClarificationFor(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      const status = err instanceof ApiError ? err.status : null;
      setTurns((prev) =>
        prev.map((t, i) =>
          i === turnIndex ? { ...t, loading: false, error: message, errorStatus: status } : t,
        ),
      );
      setPendingClarificationFor(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 md:px-8 py-5">
        <h1 className="text-2xl font-semibold tracking-tight">Troubleshooting</h1>
        <p className="text-muted-foreground text-base mt-1">
          Ask a question about indexed equipment manuals. Answers cite the exact source page.
          When equipment context is missing, the agent will ask before answering.
        </p>
      </div>

      <div className="flex-1 overflow-auto px-4 md:px-8 py-6 space-y-6">
        <RecentQuestions newTurnCount={turns.length} />
        {turns.length === 0 && <EmptyState />}
        {turns.map((turn, idx) => (
          <ConversationTurn key={idx} turn={turn} />
        ))}
      </div>

      <form onSubmit={handleSubmit} className="border-t bg-background px-4 md:px-8 py-4">
        <div className="max-w-4xl mx-auto space-y-2">
          {pendingClarificationFor && (
            <div className="text-xs text-amber-500 flex items-center gap-1.5">
              <HelpCircle className="h-3 w-3" /> Replying to the agent's clarifying question
            </div>
          )}
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                pendingClarificationFor
                  ? "Type your clarification (e.g., the air compressor)…"
                  : "What does high discharge temperature on a rotary screw compressor indicate?"
              }
              disabled={submitting}
              className="flex-1"
              autoFocus
            />
            <Button type="submit" disabled={submitting || !draft.trim()}>
              <Send className="h-4 w-4 mr-2" /> Ask
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Ready when you are</CardTitle>
        <CardDescription>Try one of these to get started:</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-2">
        <p>· What causes high discharge temperature on a rotary screw compressor?</p>
        <p>· How is cavitation diagnosed in a centrifugal pump?</p>
        <p>· What are common causes of a generator failing to start?</p>
      </CardContent>
    </Card>
  );
}

function ConversationTurn({ turn }: { turn: Turn }) {
  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground rounded-lg px-4 py-2 max-w-[80%] text-sm">
          {turn.question}
          {turn.isClarification && (
            <span className="block text-[10px] opacity-70 mt-1">↑ clarification reply</span>
          )}
        </div>
      </div>

      {turn.loading && <LoadingResponse />}
      {turn.error && <ErrorResponse message={turn.error} status={turn.errorStatus} />}
      {turn.result && <ResultResponse result={turn.result} />}
    </div>
  );
}

function LoadingResponse() {
  return (
    <Card className="max-w-[90%]">
      <CardContent className="py-4 text-sm text-muted-foreground">
        Searching indexed documents and generating a cited answer…
      </CardContent>
    </Card>
  );
}

function ErrorResponse({ message, status }: { message: string; status: number | null }) {
  if (status === 429) {
    return (
      <Card className="max-w-[90%] border-amber-500/40 bg-amber-500/5">
        <CardContent className="py-4 text-sm">
          <div className="text-amber-500 font-medium mb-1">Hourly limit reached</div>
          <div className="text-foreground">{message}</div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="max-w-[90%] border-destructive/40">
      <CardContent className="py-4 text-sm text-destructive">{message}</CardContent>
    </Card>
  );
}

function ResultResponse({ result }: { result: ChatResponse }) {
  // Clarification — agent is asking for more context before answering.
  if (result.status === "needs_clarification") {
    return (
      <Card className="max-w-[90%] border-amber-500/40 bg-amber-500/5">
        <CardContent className="py-4 text-sm flex items-start gap-3">
          <HelpCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-medium text-amber-500">Clarifying question</div>
            <div className="text-foreground">{result.response}</div>
            <div className="text-xs text-muted-foreground pt-1">
              Reply below — your answer will be combined with the original question for retrieval.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Refused — topic gate rejected.
  if (result.status === "refused") {
    return (
      <Card className="max-w-[90%] border-amber-500/40 bg-amber-500/5">
        <CardContent className="py-4 text-sm">
          <div className="text-amber-500 font-medium mb-1">Off-topic — refused</div>
          <div className="text-foreground">{result.response}</div>
        </CardContent>
      </Card>
    );
  }

  // Failed — output validator rejected an uncited answer, or an upstream error.
  if (result.status === "failed") {
    return (
      <div className="space-y-3 max-w-[90%]">
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 text-sm">
            <div className="text-destructive font-medium mb-1">
              Answer failed validation
            </div>
            <div className="text-foreground">
              {result.error ||
                "The model produced a response that did not cite the source documents. We don't return uncited answers."}
            </div>
          </CardContent>
        </Card>
        {result.chunks.length > 0 && <SourcesPanel chunks={result.chunks} />}
        <div className="text-xs text-muted-foreground">
          {result.duration_ms} ms · {result.chunks.length} sources · {result.status}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-[90%]">
      {result.response ? (
        <Card>
          <CardContent className="py-4 text-base whitespace-pre-wrap leading-relaxed">
            <RenderedAnswer text={result.response} chunks={result.chunks} />
          </CardContent>
        </Card>
      ) : result.status === "retrieval_only" ? (
        <Card className="border-dashed">
          <CardContent className="py-4 text-sm text-muted-foreground">
            Retrieved {result.chunks.length} relevant chunks. Generation requires{" "}
            <code className="font-mono">OPENROUTER_API_KEY</code> — set it in <code>.env</code> and restart
            the backend to enable cited answers.
          </CardContent>
        </Card>
      ) : null}

      {result.response && result.status === "completed" && (
        <FeedbackWidget queryId={result.query_id} />
      )}

      {result.chunks.length > 0 && <SourcesPanel chunks={result.chunks} />}

      <div className="text-xs text-muted-foreground">
        {result.duration_ms} ms · {result.chunks.length} sources · {result.status}
      </div>
    </div>
  );
}

function RecentQuestions({ newTurnCount }: { newTurnCount: number }) {
  const [history, setHistory] = useState<QueryHistoryRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Refetch when the user submits a new question, so the panel shows what
  // they just asked next time they look. Cheap query.
  useEffect(() => {
    listMyQueries(5).then(setHistory).catch(() => setHistory([]));
  }, [newTurnCount]);

  if (!history || history.length === 0) return null;

  return (
    <div className="max-w-4xl mx-auto">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Clock className="h-4 w-4" />
        Recent questions ({history.length})
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {history.map((row) => (
            <HistoryRow
              key={row.id}
              row={row}
              expanded={expanded === row.id}
              onToggle={() => setExpanded((cur) => (cur === row.id ? null : row.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryRow({
  row,
  expanded,
  onToggle,
}: {
  row: QueryHistoryRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const when = new Date(row.created_at).toLocaleString();
  return (
    <Card>
      <CardContent className="py-3">
        <button
          onClick={onToggle}
          className="w-full flex items-start gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground mt-1 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-base font-medium">{row.question}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {when} · {row.status}
            </div>
          </div>
        </button>
        {expanded && row.response && (
          <div className="mt-3 pl-6 text-base whitespace-pre-wrap leading-relaxed text-foreground border-l-2 border-zinc-200">
            <div className="pl-3">{row.response}</div>
          </div>
        )}
        {expanded && !row.response && (
          <div className="mt-3 pl-6 text-sm italic text-muted-foreground border-l-2 border-zinc-200">
            <div className="pl-3">No response captured.</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FeedbackWidget({ queryId }: { queryId: string }) {
  type Phase = "idle" | "comment" | "submitting" | "done" | "error";
  const [phase, setPhase] = useState<Phase>("idle");
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function send(r: "up" | "down", withComment: string | undefined = undefined) {
    setPhase("submitting");
    setError(null);
    try {
      await submitQueryFeedback(queryId, r, withComment);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
      setPhase("error");
    }
  }

  function pick(r: "up" | "down") {
    setRating(r);
    setPhase("comment");
  }

  if (phase === "done") {
    return (
      <div className="text-xs text-muted-foreground">Thanks for the feedback.</div>
    );
  }

  if (phase === "comment" && rating) {
    return (
      <div className="rounded-md border bg-card p-3 space-y-2">
        <div className="text-xs text-muted-foreground">
          {rating === "up" ? "Glad it helped." : "Sorry — what was off?"} Add a note (optional):
        </div>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder={
            rating === "up"
              ? "What was useful? Anything we should keep doing?"
              : "Wrong answer, missing detail, hard to find a citation, …"
          }
          className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
          autoFocus
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => send(rating, comment.trim() || undefined)}>
            Submit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => send(rating, undefined)}
          >
            Skip note
          </Button>
          <button
            onClick={() => {
              setRating(null);
              setComment("");
              setPhase("idle");
            }}
            className="text-xs text-muted-foreground hover:text-foreground ml-auto"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 text-base text-muted-foreground">
      <span>Was this answer helpful?</span>
      <button
        onClick={() => pick("up")}
        disabled={phase === "submitting"}
        className="p-2 rounded hover:bg-accent/40 hover:text-foreground disabled:opacity-40"
        title="Yes"
      >
        <ThumbsUp className="h-5 w-5" />
      </button>
      <button
        onClick={() => pick("down")}
        disabled={phase === "submitting"}
        className="p-2 rounded hover:bg-accent/40 hover:text-foreground disabled:opacity-40"
        title="No"
      >
        <ThumbsDown className="h-5 w-5" />
      </button>
      {error && <span className="text-destructive">{error}</span>}
    </div>
  );
}

function RenderedAnswer({ text, chunks }: { text: string; chunks: ChatChunk[] }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\[(\d+)\]$/.exec(part);
        if (m) {
          const idx = parseInt(m[1], 10) - 1;
          const chunk = chunks[idx];
          if (chunk) {
            return (
              <a
                key={i}
                href={chunkSourceUrl(chunk)}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline font-medium"
                title={`${chunk.document_title}, p.${chunk.page_number}`}
              >
                [{m[1]}]
              </a>
            );
          }
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function SourcesPanel({ chunks }: { chunks: ChatChunk[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Sources</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {chunks.map((c) => (
          <a
            key={c.id}
            href={chunkSourceUrl(c)}
            target="_blank"
            rel="noreferrer"
            className="flex items-start justify-between gap-3 rounded-md border p-3 hover:bg-accent/30 transition-colors"
          >
            <div className="text-xs space-y-1">
              <div className="font-medium">
                [{c.rank}] {c.document_title} · p.{c.page_number}
              </div>
              <div className="text-muted-foreground line-clamp-2">
                {c.preview || c.text.slice(0, 220)}
              </div>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
          </a>
        ))}
      </CardContent>
    </Card>
  );
}
