function readValue(keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return fallback;
}

export const env = {
  groqApiKey: readValue(["GROQ_API_KEY"], ""),
  groqTextModel: readValue(["GROQ_TEXT_MODEL"], "llama-3.3-70b-versatile"),
  ollamaModel: readValue(["OLLAMA_MODEL", "OLLAMA_MODEL "], "qwen2.5:1.5b"),
  ollamaEmbeddingModel: readValue(
    ["OLLAMA_EMBEDDING_MODEL", "OLLAMA_EMBEDDING_MODEL "],
    "qwen3-embedding:0.6b",
  ),
  ollamaEmbeddingDimension: Number.parseInt(readValue(["OLLAMA_EMBEDDING_DIMENSION"], "768"), 10) || 768,
  ollamaBaseUrl: readValue(["OLLAMA_BASE_URL"], "http://127.0.0.1:11434"),
  supabaseUrl: readValue(["SUPABASE_URL"], ""),
  supabaseServiceRoleKey: readValue(["SUPABASE_SERVICE_ROLE_KEY"], ""),
  redisUrl: readValue(["REDIS_URL"], "redis://127.0.0.1:6379"),
};
