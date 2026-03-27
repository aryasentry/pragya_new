import { NextResponse } from "next/server";
import { parseUploadedFile, previewSectionBreakdown } from "@/lib/document-parser";
import { ingestBatchToStaging } from "@/lib/ingestion";
import { readIngestionProgress, writeIngestionProgress } from "@/lib/memory";
import { resolveAdminByEmail } from "@/lib/admin";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Use multipart/form-data with fields: email and files." },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const email = String(formData.get("email") ?? "").trim();
    const admin = resolveAdminByEmail(email);

    const uploadedFiles = formData.getAll("files").filter((entry): entry is File => entry instanceof File);

    if (uploadedFiles.length === 0) {
      return NextResponse.json({ error: "At least one file is required." }, { status: 400 });
    }

    const parsedFiles = await Promise.all(uploadedFiles.map((file) => parseUploadedFile(file)));

    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();

    await writeIngestionProgress(runId, {
      runId,
      status: "running",
      totalDocuments: parsedFiles.length,
      processedDocuments: 0,
      totalChunks: 0,
      embeddedChunks: 0,
      insertedChunks: 0,
      currentDocument: null,
      message: "Preparing ingestion",
      startedAt,
      updatedAt: startedAt,
    });

    const parsedPreview = previewSectionBreakdown(parsedFiles);

    void (async () => {
      try {
        const result = await ingestBatchToStaging({
          domain: admin.domain,
          files: parsedFiles,
          onProgress: async (progress) => {
            await writeIngestionProgress(runId, {
              runId,
              status: progress.status,
              totalDocuments: progress.totalDocuments,
              processedDocuments: progress.processedDocuments,
              totalChunks: progress.totalChunks,
              embeddedChunks: progress.embeddedChunks,
              insertedChunks: progress.insertedChunks,
              currentDocument: progress.currentDocument,
              message: progress.message,
              startedAt,
              updatedAt: new Date().toISOString(),
            });
          },
        });

        await writeIngestionProgress(runId, {
          runId,
          status: "completed",
          totalDocuments: result.documentsProcessed,
          processedDocuments: result.documentsProcessed,
          totalChunks: result.totalChunks,
          embeddedChunks: result.totalEmbeddedChunks,
          insertedChunks: result.totalChunks,
          currentDocument: null,
          message: "Ingestion completed",
          startedAt,
          updatedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        });
      } catch (error) {
        await writeIngestionProgress(runId, {
          runId,
          status: "failed",
          totalDocuments: parsedFiles.length,
          processedDocuments: 0,
          totalChunks: 0,
          embeddedChunks: 0,
          insertedChunks: 0,
          currentDocument: null,
          message: "Ingestion failed",
          error: error instanceof Error ? error.message : "Unknown ingestion error",
          startedAt,
          updatedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        });
      }
    })();

    return NextResponse.json({ runId, parsedPreview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ingestion failed." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId") ?? "";

    if (!runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }

    const progress = await readIngestionProgress(runId);
    if (!progress) {
      return NextResponse.json({ error: "Ingestion run not found or expired." }, { status: 404 });
    }

    return NextResponse.json(progress);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to fetch ingestion status." },
      { status: 500 },
    );
  }
}
