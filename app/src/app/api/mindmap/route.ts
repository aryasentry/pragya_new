import { NextResponse } from "next/server";
import { chatWithOllama, generateEmbedding } from "@/lib/ollama";
import { hybridRetrieve } from "@/lib/retriever";
import { routeQuestionToDomain } from "@/lib/router";
import { supabaseServer } from "@/lib/supabase";
import { Domain, RetrievedChunk } from "@/lib/types";

type MindmapNodeKind = "query" | "section" | "definition" | "punishment" | "entity";

type MindmapNode = {
  id: string;
  label: string;
  kind: MindmapNodeKind;
  summary: string;
  sectionNumber?: string;
  chapter?: string;
  documentName?: string;
};

type MindmapEdge = {
  source: string;
  target: string;
  label: string;
};

type MindmapGraph = {
  query: string;
  nodes: MindmapNode[];
  edges: MindmapEdge[];
};

type MindmapRequest = {
  userId: string;
  query: string;
  action: "generate" | "expand" | "define";
  mindmapId?: string;
  graph?: MindmapGraph;
  focusNodeId?: string;
  nodeId?: string;
};

type PersistedMindmapRow = {
  id: string;
  user_id: string;
  domain: Domain;
  query: string;
  action: "generate" | "expand" | "define";
  graph: MindmapGraph;
  sources: string[];
  node_count: number;
  edge_count: number;
  created_at: string;
  updated_at: string;
};

type NormalizedEntity = {
  id: string;
  type: string;
  name: string;
};

type NormalizedRelationship = {
  type: string;
  source: string;
  target: string;
  label: string;
};

function sectionNodeId(chunk: RetrievedChunk): string {
  return sanitizeId(`section_${chunk.section_number ?? chunk.id}`);
}

function sanitizeId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function compactText(text: string, max = 320): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 3)}...`;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  const braces = trimmed.match(/\{[\s\S]*\}/);
  if (!braces?.[0]) {
    return null;
  }

  try {
    return JSON.parse(braces[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toKind(value: string): MindmapNodeKind {
  const normalized = value.toLowerCase().trim();
  if (normalized === "query") return "query";
  if (normalized === "section") return "section";
  if (normalized === "definition") return "definition";
  if (normalized === "punishment") return "punishment";
  return "entity";
}

function normalizeGraph(input: unknown, query: string): MindmapGraph {
  const root: MindmapGraph = {
    query,
    nodes: [
      {
        id: "query",
        label: "Query",
        kind: "query",
        summary: query,
      },
    ],
    edges: [],
  };

  if (!input || typeof input !== "object") {
    return root;
  }

  const payload = input as { nodes?: unknown[]; edges?: unknown[] };
  const nodes: MindmapNode[] = [];
  const ids = new Set<string>();

  for (const item of payload.nodes ?? []) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const row = item as Record<string, unknown>;
    const rawLabel = String(row.label ?? "").trim();
    if (!rawLabel) {
      continue;
    }

    const id = sanitizeId(String(row.id ?? rawLabel));
    if (!id || ids.has(id)) {
      continue;
    }

    ids.add(id);
    nodes.push({
      id,
      label: rawLabel,
      kind: toKind(String(row.kind ?? "entity")),
      summary: compactText(String(row.summary ?? rawLabel), 220),
      sectionNumber: row.sectionNumber ? String(row.sectionNumber) : undefined,
      chapter: row.chapter ? String(row.chapter) : undefined,
      documentName: row.documentName ? String(row.documentName) : undefined,
    });
  }

  if (!ids.has("query")) {
    nodes.unshift({
      id: "query",
      label: "Query",
      kind: "query",
      summary: query,
    });
    ids.add("query");
  }

  const edges: MindmapEdge[] = [];
  const edgeSet = new Set<string>();

  for (const item of payload.edges ?? []) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const source = sanitizeId(String(row.source ?? ""));
    const target = sanitizeId(String(row.target ?? ""));
    if (!source || !target || !ids.has(source) || !ids.has(target) || source === target) {
      continue;
    }
    const label = compactText(String(row.label ?? "related"), 60);
    const key = `${source}|${target}|${label}`;
    if (edgeSet.has(key)) {
      continue;
    }
    edgeSet.add(key);
    edges.push({ source, target, label });
  }

  return { query, nodes, edges };
}

function ensureMinimumGraph(graph: MindmapGraph, chunks: RetrievedChunk[], minimumNodes = 5): MindmapGraph {
  const byId = new Map<string, MindmapNode>(graph.nodes.map((node) => [node.id, node]));
  const edgeSet = new Set(graph.edges.map((edge) => `${edge.source}|${edge.target}|${edge.label}`));
  const edges = [...graph.edges];

  if (!byId.has("query")) {
    byId.set("query", { id: "query", label: "Query", kind: "query", summary: graph.query });
  }

  for (const chunk of chunks) {
    if (byId.size >= minimumNodes) {
      break;
    }

    const section = chunk.section_number ? `Section ${chunk.section_number}` : "Section";
    const label = chunk.section_name ? `${section}: ${compactText(chunk.section_name, 34)}` : section;
    const id = sanitizeId(`section_${chunk.section_number ?? chunk.id}`);
    if (id && !byId.has(id)) {
      byId.set(id, {
        id,
        label: compactText(label, 54),
        kind: "section",
        summary: compactText(chunk.content, 160),
        sectionNumber: chunk.section_number ?? undefined,
        documentName: chunk.document_name,
      });
    }
  }

  for (const chunk of chunks) {
    if (byId.size >= minimumNodes) {
      break;
    }
    for (const entity of normalizeEntities(chunk)) {
      if (byId.size >= minimumNodes) {
        break;
      }
      if (!entity.id || byId.has(entity.id)) {
        continue;
      }
      byId.set(entity.id, {
        id: entity.id,
        label: compactText(entity.name, 56),
        kind: entity.type === "definition" ? "definition" : "entity",
        summary: compactText(`${entity.type}: ${entity.name}`, 160),
        sectionNumber: chunk.section_number ?? undefined,
        documentName: chunk.document_name,
      });
    }
  }

  const nodes = [...byId.values()];

  // Prefer real extracted relationships from chunks when both endpoints exist.
  for (const chunk of chunks) {
    for (const rel of normalizeRelationships(chunk)) {
      if (!byId.has(rel.source) || !byId.has(rel.target)) {
        continue;
      }
      const safeLabel = sanitizeId(rel.label).replace(/_/g, " ") || "related";
      const key = `${rel.source}|${rel.target}|${safeLabel}`;
      if (edgeSet.has(key)) {
        continue;
      }
      edgeSet.add(key);
      edges.push({
        source: rel.source,
        target: rel.target,
        label: safeLabel,
      });
    }
  }

  for (const node of nodes) {
    if (node.id === "query") {
      continue;
    }
    const key = `query|${node.id}|related_to_query`;
    if (edgeSet.has(key)) {
      continue;
    }
    edgeSet.add(key);
    edges.push({ source: "query", target: node.id, label: "related to query" });
  }

  let hasNonQueryEdge = edges.some((edge) => edge.source !== "query" && edge.target !== "query");
  if (!hasNonQueryEdge) {
    const nonQueryNodes = nodes.filter((node) => node.id !== "query");
    for (let i = 0; i < nonQueryNodes.length - 1; i += 1) {
      const source = nonQueryNodes[i]?.id;
      const target = nonQueryNodes[i + 1]?.id;
      if (!source || !target) {
        continue;
      }
      const key = `${source}|${target}|co_occurs_with`;
      if (edgeSet.has(key)) {
        continue;
      }
      edgeSet.add(key);
      edges.push({ source, target, label: "co-occurs with" });
      hasNonQueryEdge = true;
      break;
    }
  }

  return {
    query: graph.query,
    nodes,
    edges,
  };
}

function mergeGraphs(base: MindmapGraph, incoming: MindmapGraph): MindmapGraph {
  const byId = new Map<string, MindmapNode>();

  for (const node of [...base.nodes, ...incoming.nodes]) {
    if (!byId.has(node.id)) {
      byId.set(node.id, node);
      continue;
    }

    const previous = byId.get(node.id)!;
    byId.set(node.id, {
      ...previous,
      ...node,
      summary: node.summary || previous.summary,
    });
  }

  const nodes = [...byId.values()];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edgeSet = new Set<string>();
  const edges: MindmapEdge[] = [];

  for (const edge of [...base.edges, ...incoming.edges]) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }
    const key = `${edge.source}|${edge.target}|${edge.label}`;
    if (edgeSet.has(key)) {
      continue;
    }
    edgeSet.add(key);
    edges.push(edge);
  }

  return {
    query: incoming.query || base.query,
    nodes,
    edges,
  };
}

function normalizeEntities(chunk: RetrievedChunk): NormalizedEntity[] {
  const entities: NormalizedEntity[] = [];
  const raw = Array.isArray(chunk.entities) ? chunk.entities : [];

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const name = String(row.name ?? "").trim();
    const type = String(row.type ?? "entity").trim().toLowerCase();
    if (!name) {
      continue;
    }
    entities.push({
      id: sanitizeId(String(row.id ?? `${type}_${name}`)),
      type,
      name,
    });
  }

  if (chunk.section_number) {
    entities.push({
      id: sectionNodeId(chunk),
      type: "section",
      name: `Section ${chunk.section_number} ${chunk.section_name ?? ""}`.trim(),
    });
  }

  // On-demand extraction from retrieved text (mindmap-time, not ingestion-time).
  const content = chunk.content ?? "";
  const termMatches = content.matchAll(/["']([A-Za-z][A-Za-z\s-]{2,80})["']\s+(means|includes|denotes)\b/gi);
  for (const match of termMatches) {
    const term = (match[1] ?? "").trim();
    if (!term) {
      continue;
    }
    entities.push({
      id: sanitizeId(`term_${term}`),
      type: "term",
      name: term,
    });
  }

  const seen = new Set<string>();
  return entities.filter((item) => {
    const key = `${item.id}|${item.type}|${item.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeRelationships(chunk: RetrievedChunk): NormalizedRelationship[] {
  const relationships: NormalizedRelationship[] = [];
  const raw = Array.isArray(chunk.relationships) ? chunk.relationships : [];

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const row = item as Record<string, unknown>;
    const source = sanitizeId(String(row.source ?? ""));
    const target = sanitizeId(String(row.target ?? ""));
    if (!source || !target) {
      continue;
    }

    relationships.push({
      type: String(row.type ?? "related"),
      source,
      target,
      label: compactText(String(row.label ?? "related"), 60),
    });
  }

  // On-demand extraction from text.
  const source = sectionNodeId(chunk);
  const content = chunk.content ?? "";

  const termMatches = content.matchAll(/["']([A-Za-z][A-Za-z\s-]{2,80})["']\s+(means|includes|denotes)\b/gi);
  for (const match of termMatches) {
    const term = (match[1] ?? "").trim();
    const predicate = (match[2] ?? "").toLowerCase();
    if (!term) {
      continue;
    }
    relationships.push({
      type: predicate === "includes" ? "includes_term" : "defines_term",
      source,
      target: sanitizeId(`term_${term}`),
      label: predicate === "includes" ? "includes term" : "defines term",
    });
  }

  const sectionRefs = content.matchAll(/\bsection\s+(\d+[A-Za-z]?)\b/gi);
  for (const match of sectionRefs) {
    const ref = (match[1] ?? "").trim();
    if (!ref) {
      continue;
    }
    relationships.push({
      type: "cross_reference",
      source,
      target: sanitizeId(`section_${ref}`),
      label: "cross-reference",
    });
  }

  const seen = new Set<string>();
  return relationships.filter((item) => {
    const key = `${item.source}|${item.target}|${item.label}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function chunksToContext(chunks: RetrievedChunk[]): string {
  return chunks
    .slice(0, 16)
    .map((chunk, index) => {
      const entities = normalizeEntities(chunk)
        .slice(0, 12)
        .map((entity) => `${entity.type}:${entity.name}`)
        .join(" | ");
      const relationships = normalizeRelationships(chunk)
        .slice(0, 10)
        .map((rel) => `${rel.source}->${rel.target} (${rel.label})`)
        .join(" | ");

      return [
        `Chunk C${index + 1}`,
        `Document: ${chunk.document_name}`,
        `Section: ${chunk.section_number ?? "n/a"} ${chunk.section_name ?? ""}`.trim(),
        `Title: ${chunk.title ?? "n/a"}`,
        `Content: ${compactText(chunk.content, 460)}`,
        `Entities: ${entities || "n/a"}`,
        `Relationships: ${relationships || "n/a"}`,
      ].join("\n");
    })
    .join("\n\n");
}

function buildSources(chunks: RetrievedChunk[]): string[] {
  return chunks.slice(0, 8).map((chunk) => {
    const section = `${chunk.section_number ?? "n/a"} ${chunk.section_name ?? ""}`.trim();
    return `${chunk.document_name} | Section ${section} | ${chunk.title ?? "n/a"}`;
  });
}

async function retrieveMindmapChunks(query: string): Promise<{ domain: string; chunks: RetrievedChunk[] }> {
  const domain = await routeQuestionToDomain(query);
  const embedding = await generateEmbedding(query);
  const chunks = await hybridRetrieve({
    domain,
    queryText: query,
    queryEmbedding: embedding,
    topK: 25,
  });
  return { domain, chunks: chunks.slice(0, 25) };
}

async function persistMindmap(params: {
  mindmapId?: string;
  userId: string;
  domain: Domain;
  query: string;
  action: MindmapRequest["action"];
  graph: MindmapGraph;
  sources: string[];
}): Promise<string> {
  const row = {
    user_id: params.userId,
    domain: params.domain,
    query: params.query,
    action: params.action,
    graph: params.graph,
    sources: params.sources,
    node_count: params.graph.nodes.length,
    edge_count: params.graph.edges.length,
  };

  if (params.mindmapId) {
    const { data, error } = await supabaseServer
      .from("mindmaps")
      .update(row)
      .eq("id", params.mindmapId)
      .select("id")
      .single();

    if (!error && data?.id) {
      return String(data.id);
    }
  }

  const { data, error } = await supabaseServer.from("mindmaps").insert(row).select("id").single();
  if (error || !data?.id) {
    throw new Error(`Failed to persist mindmap: ${error?.message ?? "unknown error"}`);
  }
  return String(data.id);
}

function generateGraphPrompt(params: {
  query: string;
  context: string;
  focusNode?: MindmapNode;
  existing?: MindmapGraph;
}): string {
  const focusBlock = params.focusNode
    ? `Focus node for expansion:\n${JSON.stringify(params.focusNode, null, 2)}`
    : "Focus node for expansion: none";
  const existingBlock = params.existing
    ? `Existing graph (keep and extend, do not duplicate IDs):\n${JSON.stringify(params.existing, null, 2)}`
    : "Existing graph: none";

  return [
    `User query: ${params.query}`,
    focusBlock,
    existingBlock,
    "Retrieved legal context and extracted entities/relationships:",
    params.context,
    "Return VALID JSON object with shape:",
    '{ "nodes":[{"id":"...","label":"...","kind":"query|section|definition|punishment|entity","summary":"...","sectionNumber":"optional","chapter":"optional","documentName":"optional"}], "edges":[{"source":"node_id","target":"node_id","label":"relation"}] }',
    "Rules:",
    "- Include one node with id='query', label='Query', kind='query'.",
    "- Prefer legal sections, definitions, punishments, and relationship-bearing entities.",
    "- Use short readable labels; keep summaries grounded in retrieved context only.",
    "- Make each edge label precise (e.g., defines term, punishes, cross-reference, related to query).",
    "- Return only JSON (no prose, no markdown, no code fences).",
    "- Include at least 5 nodes and at least 4 edges.",
  ].join("\n\n");
}

async function createOrExpandGraph(params: {
  query: string;
  chunks: RetrievedChunk[];
  focusNode?: MindmapNode;
  existingGraph?: MindmapGraph;
}): Promise<MindmapGraph> {
  const systemPrompt = [
    "You are a legal knowledge graph builder.",
    "Use only provided retrieved context.",
    "Never invent sections or relationships.",
    "Output strict JSON only.",
  ].join("\n");

  const raw = await chatWithOllama(
    systemPrompt,
    generateGraphPrompt({
      query: params.query,
      context: chunksToContext(params.chunks),
      focusNode: params.focusNode,
      existing: params.existingGraph,
    }),
  );

  const parsed = parseJsonObject(raw);
  const normalized = ensureMinimumGraph(normalizeGraph(parsed, params.query), params.chunks, 5);
  if (!params.existingGraph) {
    return normalized;
  }
  return ensureMinimumGraph(mergeGraphs(params.existingGraph, normalized), params.chunks, 5);
}

async function generateDefinition(params: {
  query: string;
  node: MindmapNode;
  context: string;
}): Promise<string> {
  const systemPrompt = [
    "You are a legal explainer.",
    "Answer in 2-4 sentences.",
    "Use only the supplied legal context.",
    "If context is insufficient, say so briefly.",
  ].join("\n");

  const userPrompt = [
    `Original query: ${params.query}`,
    `Selected node: ${params.node.label} (${params.node.kind})`,
    `Node summary: ${params.node.summary}`,
    `Legal context:\n${params.context}`,
    "Write a concise grounded definition/explanation for this node.",
  ].join("\n\n");

  return chatWithOllama(systemPrompt, userPrompt);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as MindmapRequest;
    if (!body.userId || !body.query || !body.action) {
      return NextResponse.json({ error: "userId, query, and action are required." }, { status: 400 });
    }

    const retrieved = await retrieveMindmapChunks(body.query);
    const sources = buildSources(retrieved.chunks);

    if (body.action === "define") {
      const activeGraph = normalizeGraph(body.graph, body.query);
      const target = activeGraph.nodes.find((node) => node.id === body.nodeId);
      if (!target) {
        return NextResponse.json({ error: "nodeId not found in graph." }, { status: 400 });
      }

      const definition = await generateDefinition({
        query: body.query,
        node: target,
        context: chunksToContext(retrieved.chunks),
      });

      const persistedMindmapId = await persistMindmap({
        mindmapId: body.mindmapId,
        userId: body.userId,
        domain: retrieved.domain as Domain,
        query: body.query,
        action: "define",
        graph: activeGraph,
        sources,
      });

      return NextResponse.json({
        mindmapId: persistedMindmapId,
        domain: retrieved.domain,
        definition,
        sources,
      });
    }

    const existing = body.graph ? normalizeGraph(body.graph, body.query) : undefined;
    const focusNode = existing?.nodes.find((node) => node.id === body.focusNodeId);
    const graph = await createOrExpandGraph({
      query: body.query,
      chunks: retrieved.chunks,
      focusNode,
      existingGraph: body.action === "expand" ? existing : undefined,
    });

    const persistedMindmapId = await persistMindmap({
      mindmapId: body.mindmapId,
      userId: body.userId,
      domain: retrieved.domain as Domain,
      query: body.query,
      action: body.action,
      graph,
      sources,
    });

    return NextResponse.json({
      mindmapId: persistedMindmapId,
      domain: retrieved.domain,
      graph,
      sources,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Mindmap generation failed.",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = (searchParams.get("userId") ?? "").trim();
    const mindmapId = (searchParams.get("mindmapId") ?? "").trim();

    if (!userId) {
      return NextResponse.json({ error: "userId is required." }, { status: 400 });
    }

    if (mindmapId) {
      const { data, error } = await supabaseServer
        .from("mindmaps")
        .select("id,user_id,domain,query,action,graph,sources,node_count,edge_count,created_at,updated_at")
        .eq("id", mindmapId)
        .eq("user_id", userId)
        .single();

      if (error || !data) {
        return NextResponse.json({ error: "Mindmap not found." }, { status: 404 });
      }

      return NextResponse.json({ mindmap: data as PersistedMindmapRow });
    }

    const { data, error } = await supabaseServer
      .from("mindmaps")
      .select("id,user_id,domain,query,action,node_count,edge_count,created_at,updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(30);

    if (error) {
      throw new Error(`Failed to load mindmaps: ${error.message}`);
    }

    return NextResponse.json({
      mindmaps: (data ?? []) as Array<
        Omit<PersistedMindmapRow, "graph" | "sources">
      >,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load saved mindmaps." },
      { status: 500 },
    );
  }
}
