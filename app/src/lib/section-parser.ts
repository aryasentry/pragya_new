import { ParsedSection, SectionIndexEntry } from "@/lib/types";

const DEFAULT_CHUNK_MAX_CHARS = Number.parseInt(process.env.RAG_CHUNK_MAX_CHARS ?? "1800", 10);
const DEFAULT_CHUNK_OVERLAP_CHARS = Number.parseInt(process.env.RAG_CHUNK_OVERLAP_CHARS ?? "240", 10);

export type HeadingMatch = {
  sectionNumber: string;
  title: string;
  offset: number;
};

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function parseIndexLine(line: string): SectionIndexEntry | null {
  const withPage = line.match(
    /^(?:section\s*)?(\d+[A-Za-z]?(?:\.\d+[A-Za-z]?)*\.?)\s*[-:.]?\s+(.+?)\s*(?:\.{2,}|\s)\s*(\d{1,4})$/i,
  );

  if (withPage) {
    return {
      sectionNumber: withPage[1].replace(/\.$/, ""),
      title: normalizeLine(withPage[2]),
      pageHint: Number.parseInt(withPage[3], 10),
    };
  }

  const withoutPage = line.match(
    /^(?:section\s*)?(\d+[A-Za-z]?(?:\.\d+[A-Za-z]?)*\.?)\s*[-:.]?\s+(.{3,120})$/i,
  );

  if (!withoutPage) {
    return null;
  }

  return {
    sectionNumber: withoutPage[1].replace(/\.$/, ""),
    title: normalizeLine(withoutPage[2]),
    pageHint: null,
  };
}

export function extractSectionIndexEntries(rawText: string): SectionIndexEntry[] {
  const lines = rawText
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((line) => line.length > 0);

  const tocStart = lines.findIndex((line) => /table\s+of\s+contents|contents|index/i.test(line));
  const candidateLines = tocStart >= 0 ? lines.slice(tocStart + 1, tocStart + 260) : lines.slice(0, 300);

  const results: SectionIndexEntry[] = [];
  const seen = new Set<string>();

  for (const line of candidateLines) {
    const parsed = parseIndexLine(line);
    if (!parsed) {
      continue;
    }

    const key = `${parsed.sectionNumber.toLowerCase()}::${parsed.title.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(parsed);
  }

  return results;
}

function findHeadingMatches(rawText: string): HeadingMatch[] {
  const regex = /(?:^|\n)\s*(?:section\s+)?(\d+[A-Za-z]?(?:\.\d+[A-Za-z]?)*\.?)\s*[\).:-]?\s+([^\n]{3,140})/gi;
  const matches: HeadingMatch[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawText)) !== null) {
    const offset = match.index;
    const sectionNumber = normalizeLine(match[1]).replace(/\.$/, "");
    const title = normalizeLine(match[2]);

    matches.push({ sectionNumber, title, offset });
  }

  return matches;
}

export function extractKnownHeadingMatches(rawText: string, indexEntries: SectionIndexEntry[]): HeadingMatch[] {
  const headings = findHeadingMatches(rawText);
  const allowedNumbers = new Set(indexEntries.map((entry) => entry.sectionNumber.toLowerCase()));
  const known: HeadingMatch[] = [];

  for (const heading of headings) {
    if (allowedNumbers.size > 0 && !allowedNumbers.has(heading.sectionNumber.toLowerCase())) {
      continue;
    }

    known.push(heading);
  }

  return known.sort((a, b) => a.offset - b.offset);
}

function trimLeadingHeadingLine(content: string, sectionNumber: string): string {
  const cleaned = content.trim();
  const regex = new RegExp(
    `^(?:section\\s+)?${sectionNumber.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*[\\).:-]?\\s+[^\\n]{1,200}\\n?`,
    "i",
  );

  return cleaned.replace(regex, "").trim();
}

export function splitTextUsingKnownHeadings(
  documentName: string,
  rawText: string,
  knownHeadings: HeadingMatch[],
): ParsedSection[] {
  if (knownHeadings.length === 0) {
    return [
      {
        sectionNumber: "0",
        title: documentName,
        content: rawText,
      },
    ];
  }

  const sections: ParsedSection[] = [];

  for (let index = 0; index < knownHeadings.length; index += 1) {
    const current = knownHeadings[index];
    const next = knownHeadings[index + 1];

    const start = current.offset;
    const end = next ? next.offset : rawText.length;
    const content = rawText.slice(start, end).trim();
    if (content.length < 10) {
      continue;
    }

    const body = trimLeadingHeadingLine(content, current.sectionNumber);
    // Ignore heading-only entries (common in TOC/arrangement pages).
    if (body.length < 40) {
      continue;
    }

    sections.push({
      sectionNumber: current.sectionNumber,
      title: current.title,
      content: body,
    });
  }

  return sections.length > 0
    ? sections
    : [
        {
          sectionNumber: "0",
          title: documentName,
          content: rawText,
        },
      ];
}

export function splitTextBySections(
  documentName: string,
  rawText: string,
  indexEntries: SectionIndexEntry[],
): ParsedSection[] {
  const headings = findHeadingMatches(rawText);

  const allowedNumbers = new Set(indexEntries.map((entry) => entry.sectionNumber.toLowerCase()));

  const filtered = headings
    .filter((heading) => allowedNumbers.size === 0 || allowedNumbers.has(heading.sectionNumber.toLowerCase()))
    .sort((a, b) => a.offset - b.offset);

  if (filtered.length === 0) {
    return [
      {
        sectionNumber: "0",
        title: documentName,
        content: rawText,
      },
    ];
  }

  const sections: ParsedSection[] = [];

  for (let index = 0; index < filtered.length; index += 1) {
    const current = filtered[index];
    const next = filtered[index + 1];

    const start = current.offset;
    const end = next ? next.offset : rawText.length;
    const content = rawText.slice(start, end).trim();

    if (content.length < 10) {
      continue;
    }

    sections.push({
      sectionNumber: current.sectionNumber,
      title: current.title,
      content,
    });
  }

  return sections.length > 0
    ? sections
    : [
        {
          sectionNumber: "0",
          title: documentName,
          content: rawText,
        },
      ];
}

export function splitSectionIntoChildChunks(
  content: string,
  maxSize = DEFAULT_CHUNK_MAX_CHARS,
  overlap = DEFAULT_CHUNK_OVERLAP_CHARS,
): string[] {
  const text = content.trim();
  const safeMaxSize = Number.isFinite(maxSize) && maxSize > 200 ? maxSize : 1800;
  const safeOverlap = Number.isFinite(overlap) && overlap >= 0 ? Math.min(overlap, safeMaxSize - 1) : 240;

  if (text.length <= safeMaxSize) {
    return [text];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const end = Math.min(cursor + safeMaxSize, text.length);
    const chunk = text.slice(cursor, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    if (end >= text.length) {
      break;
    }

    cursor = Math.max(end - safeOverlap, cursor + 1);
  }

  return chunks;
}
