import { supabaseServer } from "@/lib/supabase";
import { Domain, RetrievedChunk } from "@/lib/types";

const SEARCH_RPC_MAP: Record<Domain, string> = {
  citizen_law: "search_citizen_chunks_hybrid",
  hr_law: "search_hr_chunks_hybrid",
  company_law: "search_company_chunks_hybrid",
};

const TABLE_MAP: Record<Domain, string> = {
  citizen_law: "citizen_chunks",
  hr_law: "hr_chunks",
  company_law: "company_chunks",
};

function toRetrievedChunk(domain: Domain, row: Record<string, unknown>): RetrievedChunk {
  return {
    domain,
    id: Number(row.id),
    content: String(row.content ?? ""),
    document_name: String(row.document_name ?? ""),
    section_name: (row.section_name as string | null) ?? null,
    section_number: (row.section_number as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    ocr_text: (row.ocr_text as string | null) ?? null,
    image_description: (row.image_description as string | null) ?? null,
    parent_id: (row.parent_id as number | null) ?? null,
    parent_content: (row.parent_content as string | null) ?? null,
    entities: (row.entities as unknown[]) ?? [],
    relationships: (row.relationships as unknown[]) ?? [],
    vector_score: Number(row.vector_score ?? 0),
    bm25_score: Number(row.bm25_score ?? 0),
    final_score: Number(row.final_score ?? 0),
    created_at: String(row.created_at ?? new Date(0).toISOString()),
  };
}

async function lexicalFallbackRetrieve(params: {
  domain: Domain;
  queryText: string;
  topK: number;
}): Promise<RetrievedChunk[]> {
  const table = TABLE_MAP[params.domain];
  const cleaned = params.queryText.replace(/["'`\u201c\u201d]/g, " ").trim();

  let { data, error } = await supabaseServer
    .from(table)
    .select(
      "id,content,document_name,section_name,section_number,title,description,ocr_text,image_description,parent_id,entities,relationships,created_at",
    )
    .eq("level", "child")
    .eq("type", "content")
    .textSearch("tsv", cleaned, { config: "english", type: "websearch" })
    .limit(params.topK);

  if (error && /column .*level|column .*type/i.test(error.message)) {
    const retry = await supabaseServer
      .from(table)
      .select(
        "id,content,document_name,section_name,section_number,title,description,ocr_text,image_description,parent_id,entities,relationships,created_at",
      )
      .textSearch("tsv", cleaned, { config: "english", type: "websearch" })
      .limit(params.topK);

    data = retry.data;
    error = retry.error;
  }

  if (error || !data?.length) {
    const queryTokens = cleaned
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9_]/g, ""))
      .filter((token) => token.length > 3)
      .slice(0, 3);

    if (!queryTokens.length) {
      return [];
    }

    const orFilter = queryTokens
      .flatMap((token) => [
        `content.ilike.%${token}%`,
        `title.ilike.%${token}%`,
        `section_name.ilike.%${token}%`,
        `section_number.ilike.%${token}%`,
      ])
      .join(",");

    let ilikeFallback = await supabaseServer
      .from(table)
      .select(
        "id,content,document_name,section_name,section_number,title,description,ocr_text,image_description,parent_id,entities,relationships,created_at",
      )
      .eq("level", "child")
      .eq("type", "content")
      .or(orFilter)
      .limit(Math.max(params.topK * 4, 20));

    if (ilikeFallback.error && /column .*level|column .*type/i.test(ilikeFallback.error.message)) {
      ilikeFallback = await supabaseServer
        .from(table)
        .select(
          "id,content,document_name,section_name,section_number,title,description,ocr_text,image_description,parent_id,entities,relationships,created_at",
        )
        .or(orFilter)
        .limit(Math.max(params.topK * 4, 20));
    }

    if (ilikeFallback.error || !ilikeFallback.data?.length) {
      return [];
    }

    const ranked = ilikeFallback.data
      .map((row) => {
        const searchable = [
          String(row.content ?? ""),
          String(row.title ?? ""),
          String(row.section_name ?? ""),
          String(row.section_number ?? ""),
        ]
          .join(" ")
          .toLowerCase();
        const hitCount = queryTokens.reduce((count, token) => {
          return count + (searchable.includes(token) ? 1 : 0);
        }, 0);
        return { row, hitCount };
      })
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, params.topK)
      .map((item) => item.row);

    return ranked.map((row) => toRetrievedChunk(params.domain, row));
  }

  return data.map((row) => toRetrievedChunk(params.domain, row));
}

export async function hybridRetrieve(params: {
  domain: Domain;
  queryText: string;
  queryEmbedding: number[];
  metadataFilter?: Record<string, string>;
  topK?: number;
}): Promise<RetrievedChunk[]> {
  const rpcName = SEARCH_RPC_MAP[params.domain];
  const topK = params.topK ?? 25;
  const metadataFilter = params.metadataFilter ?? {};

  let { data, error } = await supabaseServer.rpc(rpcName, {
    p_query_text: params.queryText,
    p_query_embedding: params.queryEmbedding,
    p_match_count: topK,
    p_metadata_filter: JSON.stringify(metadataFilter),
  });

  if (error) {
    const retry = await supabaseServer.rpc(rpcName, {
      p_query_text: params.queryText,
      p_query_embedding: params.queryEmbedding,
      p_match_count: topK,
      p_metadata_filter: metadataFilter,
    });

    data = retry.data;
    error = retry.error;
  }

  if (error) {
    const retry = await supabaseServer.rpc(rpcName, {
      p_query_text: params.queryText,
      p_query_embedding: params.queryEmbedding,
      p_match_count: topK,
    });

    data = retry.data;
    error = retry.error;
  }

  if (error) {
    const lexical = await lexicalFallbackRetrieve({
      domain: params.domain,
      queryText: params.queryText,
      topK,
    });

    if (lexical.length > 0) {
      return lexical;
    }

    throw new Error(`Hybrid retrieval failed: ${error.message}`);
  }

  return (data ?? []).map((row) => toRetrievedChunk(params.domain, row as Record<string, unknown>));
}
