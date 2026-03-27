import { NextResponse } from "next/server";
import { describeImageWithGroq } from "@/lib/groq";
import { generateEmbedding, chatWithOllama } from "@/lib/ollama";
import { hybridRetrieve } from "@/lib/retriever";
import { routeQuestionToDomain } from "@/lib/router";
import { RetrievedChunk } from "@/lib/types";

type ChatRequest = {
  userId: string;
  message: string;
  imageBase64?: string;
  imageMimeType?: string;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter((token) => token.length >= 3);
}

function extractKeywords(text: string): string[] {
  const stopwords = new Set([
    "the",
    "is",
    "are",
    "was",
    "were",
    "what",
    "which",
    "who",
    "whom",
    "whose",
    "why",
    "how",
    "when",
    "where",
    "does",
    "do",
    "did",
    "can",
    "could",
    "should",
    "would",
    "under",
    "with",
    "for",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "by",
    "a",
    "an",
  ]);

  return tokenize(text).filter((token) => !stopwords.has(token)).slice(0, 12);
}

function supportScore(chunk: RetrievedChunk, queryTokens: string[]): number {
  const searchable = [
    chunk.document_name,
    chunk.title ?? "",
    chunk.section_name ?? "",
    chunk.section_number ?? "",
    chunk.content,
    chunk.parent_content ?? "",
  ]
    .join(" ")
    .toLowerCase();

  const hits = queryTokens.reduce((count, token) => {
    return count + (searchable.includes(token) ? 1 : 0);
  }, 0);

  const retrievalWeight = chunk.final_score * 10 + chunk.bm25_score * 2 + chunk.vector_score;
  return hits * 100 + retrievalWeight;
}

function selectContextChunks(chunks: RetrievedChunk[], queryText: string): RetrievedChunk[] {
  const queryTokens = tokenize(queryText);
  const ranked = [...chunks]
    .map((chunk) => ({ chunk, score: supportScore(chunk, queryTokens) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.chunk);

  return ranked.slice(0, 12);
}

function buildInsufficientAnswer(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "I do not have enough retrieved evidence in the ingested documents to answer this reliably. Please rephrase or add the specific section/keyword to retrieve the right provision.";
  }

  const hints = chunks
    .slice(0, Math.min(3, chunks.length))
    .map((chunk, index) => {
      const sourceId = `C${index + 1}`;
      const sectionLine = `${chunk.section_number ?? "n/a"} ${chunk.section_name ?? ""}`.trim();
      return `[${sourceId}] ${chunk.document_name} | Section ${sectionLine} | ${chunk.title ?? "n/a"}`;
    })
    .join("\n");

  return [
    "I do not have enough direct evidence in the retrieved context to answer this reliably.",
    "Closest retrieved sources:",
    hints,
  ].join("\n");
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function buildCitationTail(chunks: RetrievedChunk[], max = 4): string {
  return chunks
    .slice(0, Math.min(max, chunks.length))
    .map((chunk, index) => {
      const sourceId = `C${index + 1}`;
      const sectionLine = `${chunk.section_number ?? "n/a"} ${chunk.section_name ?? ""}`.trim();
      return `[${sourceId}] ${chunk.document_name} | Section ${sectionLine} | ${chunk.title ?? "n/a"}`;
    })
    .join("\n");
}

function tryDirectInclusionAnswer(question: string, chunks: RetrievedChunk[]): string | null {
  const includeMatch = question.match(/does\s+(.+?)\s+include\s+(.+?)\??$/i);
  if (!includeMatch) {
    return null;
  }

  const lhs = includeMatch[1]?.toLowerCase().trim() ?? "";
  const rhs = includeMatch[2]?.toLowerCase().trim() ?? "";
  if (!lhs || !rhs) {
    return null;
  }

  const lhsTokens = tokenize(lhs).filter((token) => token.length > 3).slice(0, 4);
  const rhsTokens = tokenize(rhs).filter((token) => token.length > 3).slice(0, 4);
  if (!lhsTokens.length || !rhsTokens.length) {
    return null;
  }

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const text = [chunk.title ?? "", chunk.section_name ?? "", chunk.content].join(" ").toLowerCase();

    const lhsHit = lhsTokens.some((token) => text.includes(token));
    const rhsHit = rhsTokens.some((token) => text.includes(token));
    if (!lhsHit || !rhsHit) {
      continue;
    }

    const sourceId = `C${index + 1}`;
    const sentence = splitSentences(chunk.content).find((line) =>
      rhsTokens.some((token) => line.toLowerCase().includes(token)),
    );

    if (sentence) {
      return `Yes. ${sentence} [${sourceId}]`;
    }

    return `Yes. The retrieved definition indicates inclusion in this context. [${sourceId}]`;
  }

  return null;
}

function buildQueryVariants(queryText: string): string[] {
  const normalized = queryText.trim();
  const variants = [normalized];
  const keywords = extractKeywords(normalized);

  if (keywords.length > 0) {
    variants.push(keywords.join(" "));
  }

  if (keywords.length >= 2) {
    variants.push(`${keywords.slice(0, 8).join(" ")} section chapter punishment definition`);
  }

  return [...new Set(variants)].filter((value) => value.length > 0);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;

    if (!body.userId || !body.message) {
      return NextResponse.json({ error: "userId and message are required." }, { status: 400 });
    }

    let queryText = body.message;
    let imageDescription = "";

    if (body.imageBase64 && body.imageMimeType) {
      imageDescription = await describeImageWithGroq(body.imageBase64, body.imageMimeType);
      queryText = `${body.message}\n\nImage context:\n${imageDescription}`;
    }

    const domain = await routeQuestionToDomain(queryText);
    let chunks: RetrievedChunk[] = [];
    let retrievalWarning: string | null = null;

    const queryVariants = buildQueryVariants(queryText);
    const merged = new Map<number, RetrievedChunk>();

    for (const variant of queryVariants) {
      try {
        const embedding = await generateEmbedding(variant);
        const variantChunks = await hybridRetrieve({
          domain,
          queryText: variant,
          queryEmbedding: embedding,
          topK: 25,
        });

        for (const chunk of variantChunks) {
          const previous = merged.get(chunk.id);
          if (!previous || chunk.final_score > previous.final_score) {
            merged.set(chunk.id, chunk);
          }
        }
      } catch (retrievalError) {
        retrievalWarning =
          retrievalError instanceof Error
            ? retrievalError.message
            : "Hybrid retrieval failed. Proceeding without retrieved context.";
      }
    }

    chunks = [...merged.values()]
      .sort((a, b) => b.final_score - a.final_score || b.bm25_score - a.bm25_score)
      .slice(0, 25);

    const contextChunks = selectContextChunks(chunks, body.message);

    if (contextChunks.length === 0) {
      return NextResponse.json({
        domain,
        answer: buildInsufficientAnswer(chunks),
        imageDescription: imageDescription || null,
        retrievalWarning,
        chunks,
      });
    }

    const contextBlock = contextChunks
      .map((chunk, index) => {
        const citationId = `C${index + 1}`;
        const parent = chunk.parent_content ? `Parent: ${chunk.parent_content}` : "Parent: n/a";
        const details = [
          `Source [${citationId}]`,
          `Doc: ${chunk.document_name}`,
          `Title: ${chunk.title ?? "n/a"}`,
          `Section: ${chunk.section_number ?? "n/a"} ${chunk.section_name ?? ""}`.trim(),
          `Content: ${chunk.content}`,
          parent,
          `OCR: ${chunk.ocr_text ?? ""}`,
          `Image Description: ${chunk.image_description ?? ""}`,
        ];

        return details.join("\n");
      })
      .join("\n\n");

    const directAnswer = tryDirectInclusionAnswer(body.message, contextChunks);
    if (directAnswer) {
      return NextResponse.json({
        domain,
        answer: `${directAnswer}\n\nCitations:\n${buildCitationTail(contextChunks, 3)}`,
        imageDescription: imageDescription || null,
        retrievalWarning,
        chunks,
      });
    }

    const systemPrompt = [
      "You are Pragya, a governance legal assistant.",
      "Use only the provided retrieved context.",
      "Do not use outside knowledge, memory, or assumptions.",
      "For each question, first identify the most directly matching line in the retrieved context, then answer.",
      "Prioritize exact legal wording such as chapter labels, section headings, definitions, and punishment clauses.",
      "If exact evidence is missing after checking retrieved context, reply that evidence is insufficient.",
      "Every factual claim must include citation tags like [C1], [C2].",
      "If you cannot cite a claim, do not make that claim.",
      "Keep answer concise: 1-3 sentences, then citations.",
      "Be legally cautious.",
    ].join("\n");

    const finalPrompt = [
      `Domain: ${domain}`,
      `Retrieved context:\n${contextBlock}`,
      imageDescription ? `Image analysis:\n${imageDescription}` : "",
      retrievalWarning ? `Retrieval warning:\n${retrievalWarning}` : "",
      `User question:\n${body.message}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const answer = await chatWithOllama(systemPrompt, finalPrompt);

    if (!/\[C\d+\]/.test(answer)) {
      const citationTail = buildCitationTail(contextChunks);
      return NextResponse.json({
        domain,
        answer: `${answer}\n\nCitations:\n${citationTail}`,
        imageDescription: imageDescription || null,
        retrievalWarning,
        chunks,
      });
    }

    return NextResponse.json({
      domain,
      answer,
      imageDescription: imageDescription || null,
      retrievalWarning,
      chunks,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Chat request failed.",
      },
      { status: 500 },
    );
  }
}


