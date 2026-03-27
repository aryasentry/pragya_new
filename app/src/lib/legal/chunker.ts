import { LegalSectionUnit, ParsedLegalDocument } from "@/lib/legal/parser";

export type LegalNodeLevel = "act" | "chapter" | "section" | "child";
export type LegalNodeType = "content" | "toc";

export type LegalChunkNode = {
  id: string;
  content: string;
  document_name: string;
  act_name: string;
  chapter: string;
  chapter_title: string;
  section_number: string;
  section_title: string;
  parent_id: string | null;
  child_id: string;
  level: LegalNodeLevel;
  type: LegalNodeType;
  description: string | null;
  ocr_text: string | null;
  image_description: string | null;
  entities: unknown[];
  relationships: unknown[];
};

export type ChunkingConfig = {
  minTokens: number;
  maxTokens: number;
};

const DEFAULT_CHUNKING: ChunkingConfig = {
  minTokens: 300,
  maxTokens: 800,
};

function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter((token) => token.length > 0).length;
  return Math.ceil(words * 1.3);
}

function summarize(text: string, limit = 180): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 3)}...`;
}

function sentenceSplit(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const sentences = normalized.split(/(?<=[.!?;:])\s+/).map((item) => item.trim()).filter(Boolean);
  return sentences.length > 0 ? sentences : [normalized];
}

function splitOversizedUnit(text: string, maxTokens: number): string[] {
  const sentences = sentenceSplit(text);
  const chunks: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) {
      return;
    }
    chunks.push(buffer.join(" ").trim());
    buffer = [];
  };

  for (const sentence of sentences) {
    const candidate = [...buffer, sentence].join(" ").trim();
    if (estimateTokens(candidate) > maxTokens && buffer.length > 0) {
      flush();
      if (estimateTokens(sentence) > maxTokens) {
        const words = sentence.split(/\s+/).filter(Boolean);
        let segment: string[] = [];
        for (const word of words) {
          const next = [...segment, word].join(" ");
          if (estimateTokens(next) > maxTokens && segment.length > 0) {
            chunks.push(segment.join(" "));
            segment = [word];
          } else {
            segment.push(word);
          }
        }
        if (segment.length > 0) {
          chunks.push(segment.join(" "));
        }
      } else {
        buffer.push(sentence);
      }
      continue;
    }

    buffer.push(sentence);
  }

  flush();
  return chunks;
}

function renderUnit(unit: LegalSectionUnit): string {
  if (unit.marker) {
    return `(${unit.marker}) ${unit.text}`.trim();
  }
  return unit.text.trim();
}

function mergeTinyTrailingChunk(chunks: string[], minTokens: number, maxTokens: number): string[] {
  if (chunks.length < 2) {
    return chunks;
  }

  const result = [...chunks];
  const last = result[result.length - 1];
  const prev = result[result.length - 2];

  if (estimateTokens(last) < minTokens && estimateTokens(`${prev} ${last}`) <= maxTokens) {
    result[result.length - 2] = `${prev}\n\n${last}`.trim();
    result.pop();
  }

  return result;
}

function chunkSectionUnits(units: LegalSectionUnit[], cfg: ChunkingConfig): string[] {
  const rendered = units.map(renderUnit).filter((value) => value.length > 0);
  const chunks: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) {
      return;
    }
    chunks.push(buffer.join("\n\n").trim());
    buffer = [];
  };

  for (const unitText of rendered) {
    const unitTokens = estimateTokens(unitText);

    if (unitTokens > cfg.maxTokens) {
      flush();
      const split = splitOversizedUnit(unitText, cfg.maxTokens);
      chunks.push(...split);
      continue;
    }

    const candidate = [...buffer, unitText].join("\n\n").trim();
    if (estimateTokens(candidate) > cfg.maxTokens && buffer.length > 0) {
      flush();
      buffer.push(unitText);
      continue;
    }

    buffer.push(unitText);
  }

  flush();
  return mergeTinyTrailingChunk(chunks, cfg.minTokens, cfg.maxTokens);
}

export function buildHierarchicalChunks(params: {
  parsed: ParsedLegalDocument;
  documentName: string;
  ocrText?: string;
  imageDescription?: string;
  config?: Partial<ChunkingConfig>;
}): {
  tocNodes: LegalChunkNode[];
  sectionNodes: LegalChunkNode[];
  childNodes: LegalChunkNode[];
} {
  const cfg: ChunkingConfig = {
    minTokens: params.config?.minTokens ?? DEFAULT_CHUNKING.minTokens,
    maxTokens: params.config?.maxTokens ?? DEFAULT_CHUNKING.maxTokens,
  };

  const tocNodes: LegalChunkNode[] = [];
  const sectionNodes: LegalChunkNode[] = [];
  const childNodes: LegalChunkNode[] = [];

  if (params.parsed.tocText.trim().length > 0) {
    const tocId = crypto.randomUUID();
    tocNodes.push({
      id: tocId,
      content: params.parsed.tocText,
      document_name: params.documentName,
      act_name: params.parsed.actName,
      chapter: "TOC",
      chapter_title: "Arrangement of Sections",
      section_number: "TOC",
      section_title: "Arrangement of Sections",
      parent_id: null,
      child_id: tocId,
      level: "chapter",
      type: "toc",
      description: "Table of contents",
      ocr_text: params.ocrText ?? null,
      image_description: params.imageDescription ?? null,
      entities: [],
      relationships: [],
    });
  }

  for (const chapter of params.parsed.chapters) {
    for (const section of chapter.sections) {
      const sectionId = crypto.randomUUID();
      const sectionContent = `${section.sectionTitle}\n\n${section.content}`.trim();

      sectionNodes.push({
        id: sectionId,
        content: sectionContent,
        document_name: params.documentName,
        act_name: params.parsed.actName,
        chapter: chapter.chapter,
        chapter_title: chapter.chapterTitle,
        section_number: section.sectionNumber,
        section_title: section.sectionTitle,
        parent_id: null,
        child_id: sectionId,
        level: "section",
        type: "content",
        description: summarize(section.sectionTitle),
        ocr_text: params.ocrText ?? null,
        image_description: params.imageDescription ?? null,
        entities: [],
        relationships: [],
      });

      const logicalUnits = section.units.length > 0 ? section.units : [{ kind: "paragraph" as const, marker: null, text: section.content }];
      const contentChunks = chunkSectionUnits(logicalUnits, cfg);

      for (const contentChunk of contentChunks) {
        const childId = crypto.randomUUID();
        childNodes.push({
          id: childId,
          content: contentChunk,
          document_name: params.documentName,
          act_name: params.parsed.actName,
          chapter: chapter.chapter,
          chapter_title: chapter.chapterTitle,
          section_number: section.sectionNumber,
          section_title: section.sectionTitle,
          parent_id: sectionId,
          child_id: childId,
          level: "child",
          type: "content",
          description: summarize(contentChunk),
          ocr_text: params.ocrText ?? null,
          image_description: params.imageDescription ?? null,
          entities: [],
          relationships: [],
        });
      }
    }
  }

  return {
    tocNodes,
    sectionNodes,
    childNodes,
  };
}


