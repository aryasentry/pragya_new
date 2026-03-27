import { env } from "@/lib/env";

function normalizeEmbeddingDimension(vector: number[]): number[] {
  const target = env.ollamaEmbeddingDimension;
  if (!Number.isFinite(target) || target <= 0) {
    return vector;
  }

  if (vector.length === target) {
    return vector;
  }

  if (vector.length > target) {
    return vector.slice(0, target);
  }

  const padded = new Array<number>(target).fill(0);
  for (let i = 0; i < vector.length; i += 1) {
    padded[i] = vector[i] ?? 0;
  }
  return padded;
}

export async function generateEmbedding(input: string): Promise<number[]> {
  const response = await fetch(`${env.ollamaBaseUrl}/api/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.ollamaEmbeddingModel,
      prompt: input,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama embedding failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as { embedding?: number[] };

  if (!payload.embedding || payload.embedding.length === 0) {
    throw new Error("Ollama embedding response did not include embedding vector.");
  }

  return normalizeEmbeddingDimension(payload.embedding);
}

export async function chatWithOllama(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await fetch(`${env.ollamaBaseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.ollamaModel,
      stream: false,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama chat failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as {
    message?: { content?: string };
  };

  const text = payload.message?.content?.trim();
  if (!text) {
    throw new Error("Ollama chat returned empty content.");
  }

  return text;
}
