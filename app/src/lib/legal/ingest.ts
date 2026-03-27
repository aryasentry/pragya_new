import { buildHierarchicalChunks, LegalChunkNode } from "@/lib/legal/chunker";
import { normalizeOcrText } from "@/lib/legal/cleaner";
import { parseLegalDocumentStructure } from "@/lib/legal/parser";

export type StructuredIngestionDocument = {
  documentName: string;
  sourceType: "pdf" | "docx" | "txt" | "image";
  rawText: string;
  normalizedText: string;
  actName: string;
  tocText: string;
  sectionNodes: LegalChunkNode[];
  childNodes: LegalChunkNode[];
  tocNodes: LegalChunkNode[];
  ocrText?: string;
  imageDescription?: string;
};

export type StructuredPreview = {
  documentName: string;
  actName: string;
  sectionCount: number;
  childChunkCount: number;
  tocDetected: boolean;
  chapters: Array<{ chapter: string; title: string; sections: number }>;
};

export function prepareStructuredDocument(params: {
  documentName: string;
  sourceType: "pdf" | "docx" | "txt" | "image";
  rawText: string;
  ocrText?: string;
  imageDescription?: string;
}): StructuredIngestionDocument {
  const cleaned = normalizeOcrText(params.rawText);
  const parsed = parseLegalDocumentStructure(cleaned.normalizedText);
  const hierarchy = buildHierarchicalChunks({
    parsed,
    documentName: params.documentName,
    ocrText: params.ocrText,
    imageDescription: params.imageDescription,
  });

  return {
    documentName: params.documentName,
    sourceType: params.sourceType,
    rawText: params.rawText,
    normalizedText: cleaned.normalizedText,
    actName: parsed.actName,
    tocText: parsed.tocText,
    tocNodes: hierarchy.tocNodes,
    sectionNodes: hierarchy.sectionNodes,
    childNodes: hierarchy.childNodes,
    ocrText: params.ocrText,
    imageDescription: params.imageDescription,
  };
}

export function validateStructuredDocument(doc: StructuredIngestionDocument): string[] {
  const errors: string[] = [];

  for (const node of doc.childNodes) {
    if (node.type === "toc") {
      errors.push(`TOC node leaked into child chunks for ${doc.documentName}`);
    }

    if (!node.section_number || node.section_number.trim().length === 0 || node.section_number === "TOC") {
      errors.push(`Child chunk missing section_number for ${doc.documentName}`);
    }

    if (!node.parent_id) {
      errors.push(`Child chunk missing parent_id for ${doc.documentName}`);
    }

    if (!node.content || node.content.trim().length === 0) {
      errors.push(`Child chunk has empty content for ${doc.documentName}`);
    }

    const sectionAnchor = `Section ${node.section_number}`;
    if (!node.description || node.description.trim().length === 0) {
      errors.push(`Child chunk missing description for ${doc.documentName} ${sectionAnchor}`);
    }
  }

  for (const section of doc.sectionNodes) {
    if (!section.section_number || section.section_number.trim().length === 0) {
      errors.push(`Section node missing section number in ${doc.documentName}`);
    }

    if (!section.section_title || section.section_title.trim().length === 0) {
      errors.push(`Section node missing section title in ${doc.documentName} section ${section.section_number}`);
    }
  }

  if (doc.childNodes.length === 0) {
    errors.push(`No child chunks generated for ${doc.documentName}`);
  }

  return errors;
}

export function buildStructuredPreview(docs: StructuredIngestionDocument[]): StructuredPreview[] {
  return docs.map((doc) => {
    const chapterMap = new Map<string, { chapter: string; title: string; sections: number }>();

    for (const section of doc.sectionNodes) {
      const key = `${section.chapter}::${section.chapter_title}`;
      const existing = chapterMap.get(key);
      if (existing) {
        existing.sections += 1;
      } else {
        chapterMap.set(key, {
          chapter: section.chapter,
          title: section.chapter_title,
          sections: 1,
        });
      }
    }

    return {
      documentName: doc.documentName,
      actName: doc.actName,
      sectionCount: doc.sectionNodes.length,
      childChunkCount: doc.childNodes.length,
      tocDetected: doc.tocText.trim().length > 0,
      chapters: [...chapterMap.values()],
    };
  });
}



