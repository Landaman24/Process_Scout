import { ExternalLink, FileText, Trash2, Upload } from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";

import { documents, type DocumentRow, type DocumentStatus } from "../api/documents";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

const PROCESSING_POLL_MS = 3_000;

export function Documents() {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const data = await documents.list();
      setDocs(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Auto-refresh while any document is mid-ingest.
  useEffect(() => {
    const anyInFlight = docs.some(
      (d) => d.ingest_status === "pending" || d.ingest_status === "processing",
    );
    if (!anyInFlight) return;
    const id = setInterval(load, PROCESSING_POLL_MS);
    return () => clearInterval(id);
  }, [docs]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setError(`${file.name}: only PDF files are accepted`);
        continue;
      }
      setUploading(true);
      try {
        await documents.upload(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Upload failed for ${file.name}`);
      } finally {
        setUploading(false);
      }
    }
    load();
  }

  async function handleDelete(doc: DocumentRow) {
    if (!confirm(`Delete "${doc.filename}"? This removes it from the index permanently.`)) return;
    try {
      await documents.delete(doc.id);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const total = docs.length;
  const totalChunks = docs.reduce((sum, d) => sum + d.num_chunks, 0);
  const totalPages = docs.reduce((sum, d) => sum + d.num_pages, 0);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-muted-foreground text-base mt-1">
          {total} indexed · {totalPages.toLocaleString()} pages · {totalChunks.toLocaleString()}{" "}
          chunks. Upload OEM manuals or internal SOPs below.
        </p>
      </div>

      <Card
        className={dragOver ? "border-primary bg-primary/5" : ""}
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" /> Upload PDF
          </CardTitle>
          <CardDescription>
            Drop a file here, or click below. Ingest runs asynchronously; the row appears immediately and
            updates to <code>completed</code> when finished.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            multiple
            onChange={(e: ChangeEvent<HTMLInputElement>) => handleFiles(e.target.files)}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading…" : "Choose PDF"}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Indexed documents</CardTitle>
          <CardDescription>
            Newest first. Status auto-refreshes every {PROCESSING_POLL_MS / 1000}s while any ingest is in
            flight.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No documents yet. Upload a PDF above, or check the seed corpus is being ingested.
            </p>
          ) : (
            <div className="space-y-2">
              {docs.map((d) => (
                <DocumentRowCard key={d.id} doc={d} onDelete={() => handleDelete(d)} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DocumentRowCard({ doc, onDelete }: { doc: DocumentRow; onDelete: () => void }) {
  return (
    <div className="border rounded-md p-3 flex items-start gap-3">
      <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <a
            href={documents.fileUrl(doc.id)}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-sm hover:underline truncate"
          >
            {doc.title || doc.filename}
          </a>
          <StatusBadge status={doc.ingest_status} />
          {doc.equipment_type && (
            <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
              {doc.equipment_type}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
          <span>{doc.num_pages} pages</span>
          <span>{doc.num_chunks} chunks</span>
          <span>{formatBytes(doc.file_size_bytes)}</span>
          <span>uploaded {new Date(doc.uploaded_at).toLocaleString()}</span>
        </div>
        {doc.summary && (
          <p className="text-xs text-muted-foreground line-clamp-2 pt-1">{doc.summary}</p>
        )}
        {doc.ingest_error && (
          <p className="text-xs text-destructive pt-1">Error: {doc.ingest_error}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <a
          href={documents.fileUrl(doc.id)}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground p-2 rounded hover:bg-accent/30"
          title="Open PDF"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <button
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive p-2 rounded hover:bg-destructive/10"
          title="Delete document"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: DocumentStatus }) {
  const styles: Record<DocumentStatus, string> = {
    pending: "bg-muted text-muted-foreground",
    processing: "bg-blue-500/15 text-blue-500 animate-pulse",
    completed: "bg-green-500/15 text-green-500",
    failed: "bg-red-500/15 text-red-500",
  };
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${styles[status]}`}>{status}</span>;
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}
