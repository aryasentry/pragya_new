import { generateEmbedding } from "@/lib/ollama";
import { prepareStructuredDocument, validateStructuredDocument } from "@/lib/legal/ingest";
import { Domain, ParsedDocumentInput, StructuredLegalNode } from "@/lib/types";
import { supabaseServer } from "@/lib/supabase";

export type IngestionProgress = {
  status: "running" | "completed" | "failed";
  totalDocuments: number;
  processedDocuments: number;
  totalChunks: number;
  embeddedChunks: number;
  insertedChunks: number;
  currentDocument: string | null;
  message: string;
  error?: string;
};

function getDomainChunkTable(domain: Domain): "citizen_chunks" | "hr_chunks" | "company_chunks" {
  if (domain === "citizen_law") return "citizen_chunks";
  if (domain === "hr_law") return "hr_chunks";
  return "company_chunks";
}

function ensureStructuredNodes(file: ParsedDocumentInput): ParsedDocumentInput {
  if (file.sectionNodes && file.childNodes) {
    return file;
  }

  const structured = prepareStructuredDocument({
    documentName: file.documentName,
    sourceType: file.sourceType,
    rawText: file.fullText,
    ocrText: file.ocrText,
    imageDescription: file.imageDescription,
  });

  return {
    ...file,
    actName: structured.actName,
    tocText: structured.tocText,
    sectionNodes: structured.sectionNodes,
    childNodes: structured.childNodes,
    tocNodes: structured.tocNodes,
    fullText: structured.normalizedText,
  };
}

function toInsertRow(node: StructuredLegalNode, parentDbId: number | null, embedding: number[] | null) {
  return {
    content: node.content,
    embedding,
    tsv: null,
    document_name: node.document_name,
    section_name: node.section_title,
    section_number: node.section_number,
    title: node.section_title,
    description: node.description,
    ocr_text: node.ocr_text,
    image_description: node.image_description,
    parent_id: parentDbId,
    child_id: null,
    entities: node.entities,
    relationships: node.relationships,
    node_uuid: node.id,
    act_name: node.act_name,
    chapter: node.chapter,
    chapter_title: node.chapter_title,
    section_title: node.section_title,
    level: node.level,
    type: node.type,
    parent_node_uuid: node.parent_id,
    child_node_uuid: node.child_id,
  };
}

export async function ingestBatchToStaging(params: {
  domain: Domain;
  files: ParsedDocumentInput[];
  onProgress?: (progress: IngestionProgress) => Promise<void> | void;
}): Promise<{
  documentsProcessed: number;
  sectionsProcessed: number;
  totalChunks: number;
  totalEmbeddedChunks: number;
}> {
  if (!params.files.length) {
    throw new Error("No files submitted for ingestion.");
  }

  const tableName = getDomainChunkTable(params.domain);
  const normalizedFiles = params.files.map((file) => ensureStructuredNodes(file));

  const totalChunks = normalizedFiles.reduce((sum, file) => sum + (file.childNodes?.length ?? 0), 0);

  let sectionsProcessed = 0;
  let processedDocuments = 0;
  let insertedChunks = 0;
  let totalEmbeddedChunks = 0;

  if (params.onProgress) {
    await params.onProgress({
      status: "running",
      totalDocuments: normalizedFiles.length,
      processedDocuments,
      totalChunks,
      embeddedChunks: totalEmbeddedChunks,
      insertedChunks,
      currentDocument: null,
      message: "Ingestion started",
    });
  }

  for (const file of normalizedFiles) {
    if (params.onProgress) {
      await params.onProgress({
        status: "running",
        totalDocuments: normalizedFiles.length,
        processedDocuments,
        totalChunks,
        embeddedChunks: totalEmbeddedChunks,
        insertedChunks,
        currentDocument: file.documentName,
        message: `Processing ${file.documentName}`,
      });
    }

    const docValidation = validateStructuredDocument({
      documentName: file.documentName,
      sourceType: file.sourceType,
      rawText: file.fullText,
      normalizedText: file.fullText,
      actName: file.actName ?? file.documentName,
      tocText: file.tocText ?? "",
      tocNodes: file.tocNodes ?? [],
      sectionNodes: file.sectionNodes ?? [],
      childNodes: file.childNodes ?? [],
      ocrText: file.ocrText,
      imageDescription: file.imageDescription,
    });

    if (docValidation.length > 0) {
      throw new Error(`Validation failed for ${file.documentName}: ${docValidation.join(" | ")}`);
    }

    const sectionIdMap = new Map<string, number>();

    for (const tocNode of file.tocNodes ?? []) {
      const { error } = await supabaseServer.from(tableName).insert(toInsertRow(tocNode, null, null));
      if (error) {
        throw new Error(`Failed inserting TOC node for ${file.documentName}: ${error.message}`);
      }
    }

    for (const sectionNode of file.sectionNodes ?? []) {
      const { data, error } = await supabaseServer
        .from(tableName)
        .insert(toInsertRow(sectionNode, null, null))
        .select("id,node_uuid")
        .single();

      if (error || !data) {
        throw new Error(`Failed inserting section node for ${file.documentName}: ${error?.message ?? "unknown"}`);
      }

      sectionsProcessed += 1;
      sectionIdMap.set(String(data.node_uuid), Number(data.id));
    }

    for (const childNode of file.childNodes ?? []) {
      if (childNode.type === "toc") {
        throw new Error(`TOC chunk cannot be embedded for ${file.documentName}.`);
      }

      if (!childNode.section_number || childNode.section_number.trim().length === 0) {
        throw new Error(`Child chunk missing section number for ${file.documentName}.`);
      }

      if (!childNode.content || childNode.content.trim().length === 0) {
        throw new Error(`Child chunk empty content for ${file.documentName}.`);
      }

      const parentUuid = childNode.parent_id ?? "";
      const parentDbId = sectionIdMap.get(parentUuid);
      if (!parentDbId) {
        throw new Error(`Missing parent section mapping for ${file.documentName} chunk ${childNode.child_id}.`);
      }

      const embedding = await generateEmbedding(childNode.content);
      if (!embedding || embedding.length === 0) {
        throw new Error(`Embedding generation failed for ${file.documentName} chunk ${childNode.child_id}.`);
      }

      totalEmbeddedChunks += 1;

      const { error } = await supabaseServer.from(tableName).insert(toInsertRow(childNode, parentDbId, embedding));
      if (error) {
        throw new Error(`Failed inserting child chunk for ${file.documentName}: ${error.message}`);
      }

      insertedChunks += 1;

      if (params.onProgress) {
        await params.onProgress({
          status: "running",
          totalDocuments: normalizedFiles.length,
          processedDocuments,
          totalChunks,
          embeddedChunks: totalEmbeddedChunks,
          insertedChunks,
          currentDocument: file.documentName,
          message: `Inserted chunk ${insertedChunks} of ${totalChunks}`,
        });
      }
    }

    processedDocuments += 1;

    if (params.onProgress) {
      await params.onProgress({
        status: "running",
        totalDocuments: normalizedFiles.length,
        processedDocuments,
        totalChunks,
        embeddedChunks: totalEmbeddedChunks,
        insertedChunks,
        currentDocument: file.documentName,
        message: `Completed ${file.documentName}`,
      });
    }
  }

  return {
    documentsProcessed: normalizedFiles.length,
    sectionsProcessed,
    totalChunks,
    totalEmbeddedChunks,
  };
}

export async function listDomainFiles(domain: Domain): Promise<{
  files: Array<{ id: string; document_name: string; source_type: string; status: string; created_at: string }>;
  totalChildChunks: number;
  totalEmbeddedChildChunks: number;
}> {
  const tableName = getDomainChunkTable(domain);
  let { data, error } = await supabaseServer
    .from(tableName)
    .select("id, document_name, created_at")
    .eq("level", "child")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error && /column .*level/i.test(error.message)) {
    const retry = await supabaseServer
      .from(tableName)
      .select("id, document_name, created_at")
      .order("created_at", { ascending: false })
      .limit(5000);
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    throw new Error(`Failed to list documents: ${error.message}`);
  }

  const seen = new Set<string>();
  const docs: Array<{ id: string; document_name: string; source_type: string; status: string; created_at: string }> = [];

  for (const row of data ?? []) {
    if (seen.has(row.document_name)) {
      continue;
    }

    seen.add(row.document_name);
    docs.push({
      id: String(row.id),
      document_name: row.document_name,
      source_type: "mixed",
      status: "ingested",
      created_at: row.created_at,
    });
  }

  let totalChildChunks = 0;
  let totalEmbeddedChildChunks = 0;

  let countChild = await supabaseServer
    .from(tableName)
    .select("id", { head: true, count: "exact" })
    .eq("level", "child")
    .eq("type", "content");

  if (countChild.error && /column .*level|column .*type/i.test(countChild.error.message)) {
    countChild = await supabaseServer.from(tableName).select("id", { head: true, count: "exact" });
  }

  if (!countChild.error) {
    totalChildChunks = countChild.count ?? 0;
  }

  let countEmbedded = await supabaseServer
    .from(tableName)
    .select("id", { head: true, count: "exact" })
    .eq("level", "child")
    .eq("type", "content")
    .not("embedding", "is", null);

  if (countEmbedded.error && /column .*level|column .*type/i.test(countEmbedded.error.message)) {
    countEmbedded = await supabaseServer
      .from(tableName)
      .select("id", { head: true, count: "exact" })
      .not("embedding", "is", null);
  }

  if (!countEmbedded.error) {
    totalEmbeddedChildChunks = countEmbedded.count ?? 0;
  }

  return {
    files: docs,
    totalChildChunks,
    totalEmbeddedChildChunks,
  };
}

export async function listPendingJobs() {
  return [];
}

export async function listChunksForJob() {
  throw new Error("Chunk-by-job view is removed in direct ingestion mode.");
}

export async function approveJob() {
  throw new Error("Worker job approval is removed in direct ingestion mode.");
}

export async function rejectJob() {
  throw new Error("Worker job rejection is removed in direct ingestion mode.");
}

export async function deleteDomainFile(params: { adminEmail?: string; domain: Domain; documentName: string }) {
  const tableName = getDomainChunkTable(params.domain);
  const { error } = await supabaseServer.from(tableName).delete().eq("document_name", params.documentName);

  if (error) {
    throw new Error(`Failed to delete document chunks: ${error.message}`);
  }
}

