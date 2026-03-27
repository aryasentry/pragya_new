import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const cwd = process.cwd();
loadEnvFile(path.join(cwd, ".env"));
loadEnvFile(path.join(cwd, ".env.local"));

const question = "Which section of the BNS defines the term gender to include transgender individuals?";

async function generateEmbedding(baseUrl, model, text) {
  const response = await fetch(`${baseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Embedding failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload.embedding)) {
    throw new Error("Embedding payload missing embedding array");
  }

  const target = Number.parseInt(process.env.OLLAMA_EMBEDDING_DIMENSION || "768", 10) || 768;
  const vector = payload.embedding;
  if (vector.length > target) return vector.slice(0, target);
  if (vector.length < target) return vector.concat(new Array(target - vector.length).fill(0));
  return vector;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ollamaBase = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const embedModel = process.env.OLLAMA_EMBEDDING_MODEL || "qwen3-embedding:0.6b";

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const embedding = await generateEmbedding(ollamaBase, embedModel, question);

  const rpc1 = await supabase.rpc("search_citizen_chunks_hybrid", {
    p_query_text: question,
    p_query_embedding: embedding,
    p_match_count: 20,
    p_metadata_filter: "{}",
  });

  const rpc2 = await supabase.rpc("search_citizen_chunks_hybrid", {
    p_query_text: question,
    p_query_embedding: embedding,
    p_match_count: 20,
  });

  console.log(
    JSON.stringify(
      {
        q: question,
        rpc1Error: rpc1.error ? rpc1.error.message : null,
        rpc1Count: rpc1.data ? rpc1.data.length : 0,
        rpc2Error: rpc2.error ? rpc2.error.message : null,
        rpc2Count: rpc2.data ? rpc2.data.length : 0,
        sample: (rpc2.data || rpc1.data || []).slice(0, 3).map((row) => ({
          id: row.id,
          section_number: row.section_number,
          section_name: row.section_name,
          title: row.title,
          doc: row.document_name,
          preview: String(row.content || "").slice(0, 180),
          score: row.final_score,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
