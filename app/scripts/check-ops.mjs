import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import Redis from "ioredis";
import { createClient } from "@supabase/supabase-js";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

function logStep(name, ok, detail) {
  const state = ok ? "PASS" : "FAIL";
  console.log(`[${state}] ${name} :: ${detail}`);
}

function pickEnv(key, fallback = "") {
  const value = process.env[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function extractIndexPairs(rawText) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const tocStart = lines.findIndex((line) => /table\s+of\s+contents|contents|index/i.test(line));
  const candidateLines = tocStart >= 0 ? lines.slice(tocStart + 1, tocStart + 280) : lines.slice(0, 320);

  const pairs = [];
  const seen = new Set();

  const withPage = /^(?:section\s*)?(\d+[A-Za-z]?(?:\.\d+[A-Za-z]?)*\.?)\s*[-:.]?\s+(.+?)\s*(?:\.{2,}|\s)\s*(\d{1,4})$/i;
  const withoutPage = /^(?:section\s*)?(\d+[A-Za-z]?(?:\.\d+[A-Za-z]?)*\.?)\s*[-:.]?\s+(.{3,160})$/i;
  for (const line of candidateLines) {
    const match = line.match(withPage) ?? line.match(withoutPage);
    if (!match) continue;
    const sectionNumber = match[1].trim().replace(/\.$/, "");
    const title = match[2].trim();
    const key = `${sectionNumber}::${title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ sectionNumber, title });
    if (pairs.length >= 30) break;
  }

  return pairs;
}

async function checkOllama() {
  const baseUrl = pickEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");
  const embedModel = pickEnv("OLLAMA_EMBEDDING_MODEL", "qwen3-embedding:0.6b");

  const tagsRes = await fetch(`${baseUrl}/api/tags`);
  if (!tagsRes.ok) {
    throw new Error(`tags endpoint failed with ${tagsRes.status}`);
  }

  const embRes = await fetch(`${baseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: embedModel, prompt: "health check embedding" }),
  });

  if (!embRes.ok) {
    throw new Error(`embeddings endpoint failed with ${embRes.status}`);
  }

  const embData = await embRes.json();
  const embedding = embData.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("embedding not returned");
  }

  const finite = embedding.every((value) => Number.isFinite(value));
  if (!finite) {
    throw new Error("embedding contains non-finite values");
  }

  return embedding.length;
}

async function checkRedis() {
  const redisUrl = pickEnv("REDIS_URL", "redis://127.0.0.1:6379");
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });

  const key = `health:pragya:${Date.now()}`;
  try {
    const pong = await redis.ping();
    await redis.set(key, "ok", "EX", 30);
    const value = await redis.get(key);
    if (pong !== "PONG" || value !== "ok") {
      throw new Error("ping/set/get verification failed");
    }
    return "ping/set/get ok";
  } finally {
    await redis.quit();
  }
}

async function checkSupabase() {
  const url = pickEnv("SUPABASE_URL", "");
  const key = pickEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  if (!url || !key) {
    throw new Error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const read = await supabase.from("ingested_documents").select("id", { count: "exact", head: true });
  if (read.error) {
    throw new Error(`read failed: ${read.error.message}`);
  }

  const tempDoc = `health_check_${Date.now()}.txt`;

  const insert = await supabase
    .from("ingested_documents")
    .insert({
      domain: "citizen_law",
      document_name: tempDoc,
      source_type: "txt",
      status: "health_check",
      metadata: { source: "check-ops" },
    })
    .select("id")
    .single();

  if (insert.error || !insert.data?.id) {
    throw new Error(`write failed: ${insert.error?.message ?? "unknown"}`);
  }

  const deleteResult = await supabase.from("ingested_documents").delete().eq("id", insert.data.id);
  if (deleteResult.error) {
    throw new Error(`cleanup failed: ${deleteResult.error.message}`);
  }

  return `read ok, write/delete ok, ingested_documents count=${read.count ?? 0}`;
}

async function checkPdfParsing() {
  const workspaceRoot = path.resolve(process.cwd(), "..");
  const pdfPath = path.join(workspaceRoot, "citizen_law_data", "BNS2023.pdf");
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`sample pdf not found at ${pdfPath}`);
  }

  const parsed = await pdfParse(fs.readFileSync(pdfPath));
  if (!parsed.text || parsed.text.trim().length < 100) {
    throw new Error("pdf parsed text too short");
  }

  const pairs = extractIndexPairs(parsed.text);
  return `pages=${parsed.numpages}, chars=${parsed.text.length}, indexPairs=${pairs.length}`;
}

async function main() {
  const startedAt = Date.now();

  const checks = [
    ["Ollama", checkOllama],
    ["Redis", checkRedis],
    ["Supabase", checkSupabase],
    ["PDF Parsing", checkPdfParsing],
  ];

  let failed = false;
  for (const [name, fn] of checks) {
    try {
      const detail = await fn();
      logStep(name, true, String(detail));
    } catch (error) {
      failed = true;
      logStep(name, false, error instanceof Error ? error.message : "unknown error");
    }
  }

  const elapsed = Date.now() - startedAt;
  console.log(`Completed in ${elapsed}ms`);

  if (failed) {
    process.exitCode = 1;
  }
}

await main();
