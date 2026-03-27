import pdfParse from "pdf-parse/lib/pdf-parse";
import { describeImageWithGroq } from "@/lib/groq";
import { buildStructuredPreview, prepareStructuredDocument } from "@/lib/legal/ingest";
import { ParsedDocumentInput } from "@/lib/types";

function toBase64(buffer: Buffer): string {
  return buffer.toString("base64");
}

export function detectSourceType(filename: string, mimeType: string): "pdf" | "docx" | "txt" | "image" {
  const lower = filename.toLowerCase();

  if (mimeType.startsWith("image/") || /\.(png|jpg|jpeg|webp)$/i.test(lower)) {
    return "image";
  }

  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    return "pdf";
  }

  if (mimeType.includes("word") || lower.endsWith(".docx")) {
    return "docx";
  }

  return "txt";
}

function toParsedDocumentInput(structured: ReturnType<typeof prepareStructuredDocument>): ParsedDocumentInput {
  const sections = structured.sectionNodes.map((section) => ({
    sectionNumber: section.section_number,
    title: section.section_title,
    content: section.content,
  }));

  const sectionIndex = structured.sectionNodes.map((section) => ({
    sectionNumber: section.section_number,
    title: section.section_title,
    pageHint: null,
  }));

  return {
    documentName: structured.documentName,
    sourceType: structured.sourceType,
    fullText: structured.normalizedText,
    actName: structured.actName,
    tocText: structured.tocText,
    sectionIndex,
    sections,
    tocNodes: structured.tocNodes,
    sectionNodes: structured.sectionNodes,
    childNodes: structured.childNodes,
    ocrText: structured.ocrText,
    imageDescription: structured.imageDescription,
  };
}

export async function parseUploadedFile(file: File): Promise<ParsedDocumentInput> {
  const sourceType = detectSourceType(file.name, file.type);
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  if (sourceType === "pdf") {
    const parsed = await pdfParse(fileBuffer);
    return toParsedDocumentInput(
      prepareStructuredDocument({
        documentName: file.name,
        sourceType,
        rawText: parsed.text ?? "",
      }),
    );
  }

  if (sourceType === "txt") {
    const text = new TextDecoder().decode(fileBuffer);
    return toParsedDocumentInput(
      prepareStructuredDocument({
        documentName: file.name,
        sourceType,
        rawText: text,
      }),
    );
  }

  if (sourceType === "image") {
    const imageDescription = await describeImageWithGroq(toBase64(fileBuffer), file.type || "image/png");
    return toParsedDocumentInput(
      prepareStructuredDocument({
        documentName: file.name,
        sourceType,
        rawText: imageDescription,
        ocrText: imageDescription,
        imageDescription,
      }),
    );
  }

  throw new Error(`DOCX parsing is not implemented yet for ${file.name}. Upload PDF/TXT/Image.`);
}

export function previewSectionBreakdown(parsedDocuments: ParsedDocumentInput[]) {
  const structured = parsedDocuments.map((doc) => {
    const sectionNodes = doc.sectionNodes ?? [];
    const childNodes = doc.childNodes ?? [];
    return {
      documentName: doc.documentName,
      sourceType: doc.sourceType,
      rawText: doc.fullText,
      normalizedText: doc.fullText,
      actName: doc.actName ?? doc.documentName,
      tocText: doc.tocText ?? "",
      tocNodes: doc.tocNodes ?? [],
      sectionNodes,
      childNodes,
    };
  });

  return buildStructuredPreview(structured).map((item, index) => ({
    ...item,
    indexedSections: parsedDocuments[index]?.sectionIndex ?? [],
  }));
}
