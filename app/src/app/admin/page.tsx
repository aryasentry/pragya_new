"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MetricCard } from "@/components/ui/metric-card";
import { Panel } from "@/components/ui/panel";

type IngestionResult = {
  runId: string;
  parsedPreview?: Array<{
    documentName: string;
    sectionCount: number;
    childChunkCount: number;
  }>;
};

type IngestionProgress = {
  runId: string;
  status: "running" | "completed" | "failed";
  totalDocuments: number;
  processedDocuments: number;
  totalChunks: number;
  embeddedChunks: number;
  insertedChunks: number;
  currentDocument: string | null;
  message: string;
  error?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
};

type AdminFilesPayload = {
  files: Array<{
    id: string;
    document_name: string;
    source_type: string;
    status: string;
    created_at: string;
  }>;
  totalChildChunks?: number;
  totalEmbeddedChildChunks?: number;
};

const ADMIN_EMAILS = [
  "citizen_admin@pragya.local",
  "hr_admin@pragya.local",
  "company_admin@pragya.local",
];

export default function AdminPage() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(ADMIN_EMAILS[0]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [result, setResult] = useState<IngestionResult | null>(null);
  const [progress, setProgress] = useState<IngestionProgress | null>(null);
  const [filesData, setFilesData] = useState<AdminFilesPayload | null>(null);
  const [deleteName, setDeleteName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const queryEmail = searchParams.get("email");

  useEffect(() => {
    if (queryEmail && ADMIN_EMAILS.includes(queryEmail) && queryEmail !== email) {
      setEmail(queryEmail);
    }
  }, [queryEmail, email]);

  const domainHint = useMemo(() => {
    if (email.startsWith("citizen_")) return "citizen_law";
    if (email.startsWith("hr_")) return "hr_law";
    return "company_law";
  }, [email]);

  const effectiveChunkCount = progress?.totalChunks ?? filesData?.totalChildChunks ?? 0;
  const effectiveEmbeddedLabel = progress
    ? `${progress.embeddedChunks}/${progress.totalChunks}`
    : `${filesData?.totalEmbeddedChildChunks ?? 0}/${filesData?.totalChildChunks ?? 0}`;

  const refreshFiles = useCallback(async () => {
    const response = await fetch(`/api/admin/files?email=${encodeURIComponent(email)}`);
    const payload = (await response.json()) as AdminFilesPayload & { error?: string };

    if (!response.ok) {
      throw new Error(payload.error ?? "Could not load stored documents.");
    }

    setFilesData(payload);
  }, [email]);

  useEffect(() => {
    void refreshFiles().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "Unable to load data.");
    });
  }, [refreshFiles]);

  async function submitIngestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      if (selectedFiles.length === 0) {
        throw new Error("Select at least one file.");
      }

      const formData = new FormData();
      formData.set("email", email);
      for (const file of selectedFiles) {
        formData.append("files", file);
      }

      const response = await fetch("/api/admin/ingestion", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as IngestionResult & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Ingestion failed.");
      }

      setResult(payload);
      setProgress({
        runId: payload.runId,
        status: "running",
        totalDocuments: selectedFiles.length,
        processedDocuments: 0,
        totalChunks: 0,
        embeddedChunks: 0,
        insertedChunks: 0,
        currentDocument: null,
        message: "Ingestion started",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setMessage("Ingestion started. Live progress is running.");
      setSelectedFiles([]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Ingestion failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!result?.runId) {
      return;
    }

    if (progress?.status === "completed" || progress?.status === "failed") {
      return;
    }

    const interval = setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/admin/ingestion?runId=${encodeURIComponent(result.runId)}`);
          const payload = (await response.json()) as IngestionProgress & { error?: string };

          if (!response.ok) {
            throw new Error(payload.error ?? "Unable to fetch progress.");
          }

          setProgress(payload);

          if (payload.status === "completed") {
            setMessage("Ingestion completed.");
            await refreshFiles();
          }

          if (payload.status === "failed") {
            setError(payload.error ?? "Ingestion failed.");
          }
        } catch (pollError) {
          setError(pollError instanceof Error ? pollError.message : "Progress polling failed.");
        }
      })();
    }, 1200);

    return () => clearInterval(interval);
  }, [result?.runId, progress?.status, refreshFiles]);

  async function deleteFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const response = await fetch("/api/admin/delete-file", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          documentName: deleteName,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Delete failed.");
      }

      setDeleteName("");
      setMessage("Document chunks deleted from domain table.");
      await refreshFiles();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Delete failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="view admin-console">
      <header className="admin-titlebar">
        <h2>Pragya Admin Workspace</h2>
        <p>{domainHint.replace("_", " ")} direct ingestion</p>
      </header>

      <section className="kpi-grid">
        <MetricCard label="Stored Files" value={filesData?.files.length ?? 0} helper="in domain chunk table" />
        <MetricCard label="Chunks" value={effectiveChunkCount} helper={progress ? "current/last ingestion" : "stored"} />
        <MetricCard label="Embedded" value={effectiveEmbeddedLabel} helper={progress ? "live" : "stored"} />
      </section>

      <Panel title="Direct Ingestion" subtitle="Upload files and insert chunks directly into the domain table.">
        <form className="stack ingestion-form" onSubmit={submitIngestion}>
          <input
            type="file"
            multiple
            accept=".pdf,.txt,.png,.jpg,.jpeg,.webp"
            onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
          />
          <p className="muted ingestion-selected">Selected: {selectedFiles.length}</p>
          <button className="primary-btn" type="submit" disabled={loading || selectedFiles.length === 0}>
            {loading ? "Ingesting..." : `Ingest ${selectedFiles.length} file(s)`}
          </button>
        </form>

        {progress ? (
          <div className="status-card">
            <div className="status-row">
              <strong>Status</strong>
              <span>{progress.status}</span>
            </div>
            <div className="status-row">
              <strong>Document progress</strong>
              <span>
                {progress.processedDocuments}/{progress.totalDocuments}
              </span>
            </div>
            <div className="status-row">
              <strong>Chunk insert progress</strong>
              <span>
                {progress.insertedChunks}/{progress.totalChunks}
              </span>
            </div>
            <div className="status-row">
              <strong>Embedding progress</strong>
              <span>
                {progress.embeddedChunks}/{progress.totalChunks}
              </span>
            </div>
            <div className="status-track" aria-label="Chunk insert progress">
              <div
                className="status-fill"
                style={{
                  width: `${
                    progress.totalChunks > 0
                      ? Math.round((progress.insertedChunks / progress.totalChunks) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
            <div className="status-track" aria-label="Embedding progress">
              <div
                className="status-fill"
                style={{
                  width: `${
                    progress.totalChunks > 0
                      ? Math.round((progress.embeddedChunks / progress.totalChunks) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
            <p className="muted">{progress.message}</p>
            {progress.currentDocument ? <p className="muted">Current: {progress.currentDocument}</p> : null}
          </div>
        ) : null}
      </Panel>

      <Panel title="Stored Documents" subtitle="Documents currently present in the selected domain table.">
        <div className="inline-actions">
          <button className="secondary-btn" type="button" onClick={() => void refreshFiles()}>
            Refresh
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {(filesData?.files ?? []).map((file) => (
                <tr key={file.id}>
                  <td>{file.document_name}</td>
                  <td>{file.status}</td>
                  <td>{new Date(file.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Delete Document" subtitle="Delete all chunks for a document from the current domain table.">
        <form className="stack" onSubmit={deleteFile}>
          <input
            value={deleteName}
            onChange={(event) => setDeleteName(event.target.value)}
            placeholder="Document name (exact)"
            required
          />
          <button className="danger-btn" type="submit" disabled={loading}>
            Delete chunks
          </button>
        </form>
      </Panel>

      {message ? <p className="ok-text">{message}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
