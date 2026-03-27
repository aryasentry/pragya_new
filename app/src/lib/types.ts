export type Domain = "citizen_law" | "hr_law" | "company_law";

export type AdminRole = "citizen_admin" | "hr_admin" | "company_admin";

export type AdminProfile = {
  email: string;
  role: AdminRole;
  domain: Domain;
  displayName: string;
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  timestamp: string;
};

export type RetrievedChunk = {
  domain: string;
  id: number;
  content: string;
  document_name: string;
  section_name: string | null;
  section_number: string | null;
  title: string | null;
  description: string | null;
  ocr_text: string | null;
  image_description: string | null;
  parent_id: number | null;
  parent_content: string | null;
  entities: unknown[];
  relationships: unknown[];
  vector_score: number;
  bm25_score: number;
  final_score: number;
  created_at: string;
};

export type IngestionFileInput = {
  documentName: string;
  sourceType: "pdf" | "docx" | "txt" | "image";
  content: string;
  sectionName?: string;
  sectionNumber?: string;
  title?: string;
  description?: string;
  ocrText?: string;
  imageDescription?: string;
  entities?: Record<string, unknown>;
  relationships?: unknown[];
};

export type SectionIndexEntry = {
  sectionNumber: string;
  title: string;
  pageHint: number | null;
};

export type ParsedSection = {
  sectionNumber: string;
  title: string;
  content: string;
};

export type StructuredLegalNode = {
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
  level: "act" | "chapter" | "section" | "child";
  type: "content" | "toc";
  description: string | null;
  ocr_text: string | null;
  image_description: string | null;
  entities: unknown[];
  relationships: unknown[];
};

export type ParsedDocumentInput = {
  documentName: string;
  sourceType: "pdf" | "docx" | "txt" | "image";
  fullText: string;
  actName?: string;
  tocText?: string;
  sectionIndex: SectionIndexEntry[];
  sections: ParsedSection[];
  tocNodes?: StructuredLegalNode[];
  sectionNodes?: StructuredLegalNode[];
  childNodes?: StructuredLegalNode[];
  ocrText?: string;
  imageDescription?: string;
};

