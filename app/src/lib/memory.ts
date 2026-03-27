import Redis from "ioredis";
import { env } from "@/lib/env";
import { ChatMessage } from "@/lib/types";

let redisClient: Redis | null = null;
const inMemoryChat = new Map<string, ChatMessage[]>();
const inMemoryHeadings = new Map<string, TemporaryHeading[]>();
const inMemoryProgress = new Map<string, IngestionProgressState>();

function getRedisClient(): Redis | null {
  if (!env.redisUrl) {
    return null;
  }

  if (!redisClient) {
    redisClient = new Redis(env.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  return redisClient;
}

export async function appendChatMemory(userId: string, message: ChatMessage): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      const list = inMemoryChat.get(userId) ?? [];
      list.push(message);
      inMemoryChat.set(userId, list.slice(-30));
      return;
    }

    if (redis.status === "wait") {
      await redis.connect();
    }

    const key = `chat:${userId}`;
    await redis.rpush(key, JSON.stringify(message));
    await redis.ltrim(key, -30, -1);
  } catch {
    const list = inMemoryChat.get(userId) ?? [];
    list.push(message);
    inMemoryChat.set(userId, list.slice(-30));
  }
}

export async function readChatMemory(userId: string): Promise<ChatMessage[]> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      return inMemoryChat.get(userId) ?? [];
    }

    if (redis.status === "wait") {
      await redis.connect();
    }

    const key = `chat:${userId}`;
    const values = await redis.lrange(key, 0, -1);

    return values
      .map((item) => {
        try {
          return JSON.parse(item) as ChatMessage;
        } catch {
          return null;
        }
      })
      .filter((item): item is ChatMessage => item !== null);
  } catch {
    return inMemoryChat.get(userId) ?? [];
  }
}

export type TemporaryHeading = {
  sectionNumber: string;
  title: string;
  offset: number;
};

function normalizeDocumentKey(documentName: string): string {
  return documentName.toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
}

export async function writeTemporarySectionHeadings(
  documentName: string,
  headings: TemporaryHeading[],
  ttlSeconds = 3600,
): Promise<void> {
  const key = `ingest:headings:${normalizeDocumentKey(documentName)}`;
  try {
    const redis = getRedisClient();
    if (!redis) {
      inMemoryHeadings.set(key, headings);
      return;
    }

    if (redis.status === "wait") {
      await redis.connect();
    }

    await redis.set(key, JSON.stringify(headings), "EX", ttlSeconds);
  } catch {
    inMemoryHeadings.set(key, headings);
  }
}

export async function readTemporarySectionHeadings(documentName: string): Promise<TemporaryHeading[]> {
  const key = `ingest:headings:${normalizeDocumentKey(documentName)}`;
  try {
    const redis = getRedisClient();
    if (!redis) {
      return inMemoryHeadings.get(key) ?? [];
    }

    if (redis.status === "wait") {
      await redis.connect();
    }

    const payload = await redis.get(key);
    if (!payload) {
      return inMemoryHeadings.get(key) ?? [];
    }

    const parsed = JSON.parse(payload) as TemporaryHeading[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item) =>
        typeof item?.sectionNumber === "string" &&
        typeof item?.title === "string" &&
        typeof item?.offset === "number",
    );
  } catch {
    return inMemoryHeadings.get(key) ?? [];
  }
}

export type IngestionProgressState = {
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

export async function writeIngestionProgress(
  runId: string,
  state: IngestionProgressState,
  ttlSeconds = 3600,
): Promise<void> {
  const key = `ingest:progress:${runId}`;
  try {
    const redis = getRedisClient();
    if (!redis) {
      inMemoryProgress.set(key, state);
      return;
    }

    if (redis.status === "wait") {
      await redis.connect();
    }

    await redis.set(key, JSON.stringify(state), "EX", ttlSeconds);
  } catch {
    inMemoryProgress.set(key, state);
  }
}

export async function readIngestionProgress(runId: string): Promise<IngestionProgressState | null> {
  const key = `ingest:progress:${runId}`;
  try {
    const redis = getRedisClient();
    if (!redis) {
      return inMemoryProgress.get(key) ?? null;
    }

    if (redis.status === "wait") {
      await redis.connect();
    }

    const payload = await redis.get(key);
    if (!payload) {
      return inMemoryProgress.get(key) ?? null;
    }

    return JSON.parse(payload) as IngestionProgressState;
  } catch {
    return inMemoryProgress.get(key) ?? null;
  }
}
