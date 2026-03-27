import { splitTocAndBody } from "@/lib/legal/cleaner";

export type LegalUnitKind = "subsection" | "clause" | "explanation" | "illustration" | "paragraph";

export type LegalSectionUnit = {
  kind: LegalUnitKind;
  marker: string | null;
  text: string;
};

export type ParsedSection = {
  sectionNumber: string;
  sectionTitle: string;
  chapter: string;
  chapterTitle: string;
  content: string;
  units: LegalSectionUnit[];
};

export type ParsedChapter = {
  chapter: string;
  chapterTitle: string;
  sections: ParsedSection[];
};

export type ParsedLegalDocument = {
  actName: string;
  tocText: string;
  bodyText: string;
  chapters: ParsedChapter[];
};

type MutableSection = {
  sectionNumber: string;
  sectionTitle: string;
  chapter: string;
  chapterTitle: string;
  contentLines: string[];
};

type TocChapter = {
  chapter: string;
  chapterTitle: string;
  sectionTitles: string[];
};

type TocTitleResolver = {
  getTitle: (chapter: string, chapterIndex: number, globalIndex: number) => string | null;
  getChapterTitle: (chapter: string) => string | null;
};

function isLikelyActName(line: string): boolean {
  if (line.length < 8 || line.length > 200) {
    return false;
  }

  if (!/(sanhita|act|code|rules|regulations|manual)/i.test(line)) {
    return false;
  }

  const alpha = line.replace(/[^A-Za-z]/g, "");
  if (alpha.length === 0) {
    return false;
  }

  const upper = alpha.replace(/[^A-Z]/g, "").length;
  return upper / alpha.length > 0.55;
}

function detectActName(text: string): string {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

  for (const line of lines.slice(0, 40)) {
    if (isLikelyActName(line)) {
      return line;
    }
  }

  return lines[0] ?? "Unknown Act";
}

function looksLikeChapterLine(line: string): RegExpMatchArray | null {
  return line.match(/^CHAPTER\s+([IVXLCDM]+|[A-Z0-9]+)\b/i);
}

function looksLikeSectionStart(line: string): { sectionNumber: string; inlineTitle: string } | null {
  const trimmed = line.trim();

  const dotted = trimmed.match(/^(\d+[A-Za-z]?)\.\s*(.*)$/);
  if (dotted) {
    return {
      sectionNumber: dotted[1],
      inlineTitle: (dotted[2] ?? "").trim(),
    };
  }

  const sectionWord = trimmed.match(/^section\s+(\d+[A-Za-z]?)\b[.: -]?\s*(.*)$/i);
  if (sectionWord) {
    return {
      sectionNumber: sectionWord[1],
      inlineTitle: (sectionWord[2] ?? "").trim(),
    };
  }

  // OCR/plain-text exports sometimes drop the dot after section number.
  const numberSpace = trimmed.match(/^(\d+[A-Za-z]?)\s{2,}(.*)$/);
  if (numberSpace) {
    return {
      sectionNumber: numberSpace[1],
      inlineTitle: (numberSpace[2] ?? "").trim(),
    };
  }

  return null;
}

function looksLikeSubsectionStart(line: string): boolean {
  return /^\(\d+[A-Za-z]?\)/.test(line) || /^\([a-z]\)/i.test(line);
}

function looksLikeStandaloneTitle(line: string): boolean {
  if (line.length < 4 || line.length > 220) {
    return false;
  }

  if (/^(chapter|section|index|arrangement)/i.test(line)) {
    return false;
  }

  if (looksLikeSubsectionStart(line) || looksLikeSectionStart(line) !== null) {
    return false;
  }

  const alpha = line.replace(/[^A-Za-z]/g, "");
  if (alpha.length === 0) {
    return false;
  }

  const lowerCount = (alpha.match(/[a-z]/g) ?? []).length;
  const hasTerminalPunctuation = /[.:-]$/.test(line);

  return hasTerminalPunctuation && lowerCount >= 2;
}

function isLikelyTitleCandidate(line: string): boolean {
  if (!line || line.length < 3 || line.length > 220) {
    return false;
  }

  if (looksLikeChapterLine(line) || looksLikeSectionStart(line) || looksLikeSubsectionStart(line)) {
    return false;
  }

  if (/^(section|sections|arrangement of sections|index|illustration|illustrations|explanation)\b/i.test(line)) {
    return false;
  }

  return /[A-Za-z]/.test(line);
}

function looksLikeBodySentence(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.length > 140) {
    return true;
  }

  if (/\b(shall|means|includes|denotes|nothing|unless|person is said|is said to)\b/.test(normalized)) {
    return true;
  }

  return false;
}

function parseTocHierarchy(tocText: string): TocChapter[] {
  const lines = tocText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const chapters: TocChapter[] = [];
  let current: TocChapter | null = null;
  let pendingTitle: string | null = null;

  for (const line of lines) {
    const chapterMatch = looksLikeChapterLine(line);
    if (chapterMatch) {
      if (pendingTitle && current) {
        current.sectionTitles.push(pendingTitle);
      }

      pendingTitle = null;
      current = {
        chapter: chapterMatch[1].toUpperCase(),
        chapterTitle: `Chapter ${chapterMatch[1].toUpperCase()}`,
        sectionTitles: [],
      };
      chapters.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    if (/^section$/i.test(line)) {
      continue;
    }

    if (current.chapterTitle.startsWith("Chapter ") && isLikelyTitleCandidate(line) && !/[.;:]$/.test(line)) {
      current.chapterTitle = line;
      continue;
    }

    if (!isLikelyTitleCandidate(line)) {
      continue;
    }

    if (!pendingTitle) {
      pendingTitle = line;
      continue;
    }

    const isContinuation = !/[.;:]$/.test(pendingTitle) || /^[a-z(]/.test(line);
    if (isContinuation) {
      pendingTitle = `${pendingTitle} ${line}`.replace(/\s+/g, " ").trim();
    } else {
      current.sectionTitles.push(pendingTitle);
      pendingTitle = line;
    }
  }

  if (pendingTitle && current) {
    current.sectionTitles.push(pendingTitle);
  }

  return chapters;
}

function buildTocTitleResolver(tocText: string): TocTitleResolver {
  const tocChapters = parseTocHierarchy(tocText);
  const byChapter = new Map<string, TocChapter>();
  const globalTitles: string[] = [];

  for (const chapter of tocChapters) {
    byChapter.set(chapter.chapter, chapter);
    for (const title of chapter.sectionTitles) {
      globalTitles.push(title);
    }
  }

  return {
    getTitle: (chapter, chapterIndex, globalIndex) => {
      const record = byChapter.get(chapter);
      const chapterTitle = record?.sectionTitles[chapterIndex] ?? null;
      if (chapterTitle && chapterTitle.length > 0) {
        return chapterTitle;
      }
      return globalTitles[globalIndex] ?? null;
    },
    getChapterTitle: (chapter) => byChapter.get(chapter)?.chapterTitle ?? null,
  };
}

function extractUnitsFromSection(content: string): LegalSectionUnit[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const units: LegalSectionUnit[] = [];

  for (const paragraph of paragraphs) {
    const subsectionMatch = paragraph.match(/^\((\d+[A-Za-z]?)\)\s*(.*)$/s);
    if (subsectionMatch) {
      units.push({
        kind: "subsection",
        marker: subsectionMatch[1],
        text: subsectionMatch[2].trim(),
      });
      continue;
    }

    const clauseMatch = paragraph.match(/^\(([a-z])\)\s*(.*)$/is);
    if (clauseMatch) {
      units.push({
        kind: "clause",
        marker: clauseMatch[1].toLowerCase(),
        text: clauseMatch[2].trim(),
      });
      continue;
    }

    if (/^Explanation\b/i.test(paragraph)) {
      units.push({ kind: "explanation", marker: null, text: paragraph });
      continue;
    }

    if (/^Illustration(s)?\b/i.test(paragraph)) {
      units.push({ kind: "illustration", marker: null, text: paragraph });
      continue;
    }

    units.push({ kind: "paragraph", marker: null, text: paragraph });
  }

  return units;
}

function finalizeSection(section: MutableSection | null): ParsedSection | null {
  if (!section) {
    return null;
  }

  const content = section.contentLines.join("\n").trim();
  if (content.length === 0) {
    return null;
  }

  return {
    sectionNumber: section.sectionNumber,
    sectionTitle: section.sectionTitle.trim() || `Section ${section.sectionNumber}`,
    chapter: section.chapter,
    chapterTitle: section.chapterTitle,
    content,
    units: extractUnitsFromSection(content),
  };
}

function ensureChapter(chapters: ParsedChapter[], chapter: string, chapterTitle: string): ParsedChapter {
  const existing = chapters.find((item) => item.chapter === chapter && item.chapterTitle === chapterTitle);
  if (existing) {
    return existing;
  }

  const created: ParsedChapter = {
    chapter,
    chapterTitle,
    sections: [],
  };
  chapters.push(created);
  return created;
}

export function parseLegalDocumentStructure(normalizedText: string): ParsedLegalDocument {
  const { tocText, bodyText } = splitTocAndBody(normalizedText);
  const tocResolver = buildTocTitleResolver(tocText);
  const lines = bodyText.split("\n");

  let currentChapter = "UNSPECIFIED";
  let currentChapterTitle = "Unspecified Chapter";
  let pendingSectionTitle = "";
  let currentSection: MutableSection | null = null;

  const chapters: ParsedChapter[] = [];
  const chapterSectionCounters = new Map<string, number>();
  let globalSectionCounter = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();

    if (!line) {
      if (currentSection && currentSection.contentLines.length > 0) {
        currentSection.contentLines.push("");
      }
      continue;
    }

    const chapterMatch = looksLikeChapterLine(line);
    if (chapterMatch) {
      const finalized = finalizeSection(currentSection);
      if (finalized) {
        ensureChapter(chapters, finalized.chapter, finalized.chapterTitle).sections.push(finalized);
      }

      currentSection = null;
      currentChapter = chapterMatch[1].toUpperCase();

      const nextLine = (lines[i + 1] ?? "").trim();
      if (nextLine && !looksLikeChapterLine(nextLine) && !looksLikeSectionStart(nextLine)) {
        currentChapterTitle = nextLine;
        i += 1;
      } else {
        currentChapterTitle = tocResolver.getChapterTitle(currentChapter) ?? `Chapter ${currentChapter}`;
      }

      pendingSectionTitle = "";
      continue;
    }

    const sectionStart = looksLikeSectionStart(line);
    if (sectionStart) {
      const finalized = finalizeSection(currentSection);
      if (finalized) {
        ensureChapter(chapters, finalized.chapter, finalized.chapterTitle).sections.push(finalized);
      }

      let sectionTitle = sectionStart.inlineTitle;
      let inlineBodySeed = "";
      const chapterIndex = chapterSectionCounters.get(currentChapter) ?? 0;
      const tocFallbackTitle = tocResolver.getTitle(currentChapter, chapterIndex, globalSectionCounter) ?? "";

      if (sectionTitle && looksLikeSubsectionStart(sectionTitle)) {
        // Example: "1. (1) This Act may be called ..."
        // This is body text, not the section title.
        inlineBodySeed = sectionTitle;
        sectionTitle = "";
      } else if (sectionTitle && tocFallbackTitle && looksLikeBodySentence(sectionTitle)) {
        // Body starts on the same numbered line; prefer TOC heading as the actual section title.
        inlineBodySeed = sectionTitle;
        sectionTitle = "";
      }

      if (!sectionTitle && pendingSectionTitle) {
        sectionTitle = pendingSectionTitle;
      }

      if (!sectionTitle) {
        // If inline content is already subsection body, avoid consuming wrapped body lines as title.
        if (inlineBodySeed) {
          sectionTitle = "";
        } else {
        const lookahead: string[] = [];
        let cursor = i + 1;

        while (cursor < lines.length && lookahead.length < 2) {
          const candidate = (lines[cursor] ?? "").trim();
          if (!candidate) {
            cursor += 1;
            continue;
          }

          if (!isLikelyTitleCandidate(candidate) || looksLikeSubsectionStart(candidate)) {
            break;
          }

          lookahead.push(candidate);
          cursor += 1;
        }

        if (lookahead.length > 0) {
          const candidate = lookahead.join(" ").replace(/\s+/g, " ").trim();
          if (candidate.length <= 160) {
            sectionTitle = candidate;
          }
          i = cursor - 1;
        }
        }
      }

      chapterSectionCounters.set(currentChapter, chapterIndex + 1);

      if (!sectionTitle) {
        sectionTitle = tocFallbackTitle;
      }
      globalSectionCounter += 1;

      currentSection = {
        sectionNumber: sectionStart.sectionNumber,
        sectionTitle: sectionTitle || `Section ${sectionStart.sectionNumber}`,
        chapter: currentChapter,
        chapterTitle: currentChapterTitle,
        contentLines: [],
      };

      pendingSectionTitle = "";

      if (inlineBodySeed) {
        currentSection.contentLines.push(inlineBodySeed);
      } else if (sectionStart.inlineTitle && /\b(shall|means|includes|is|are)\b/i.test(sectionStart.inlineTitle)) {
        currentSection.contentLines.push(sectionStart.inlineTitle);
      }

      continue;
    }

    if (!currentSection) {
      if (looksLikeStandaloneTitle(line)) {
        pendingSectionTitle = line;
      }
      continue;
    }

    currentSection.contentLines.push(line);
  }

  const finalized = finalizeSection(currentSection);
  if (finalized) {
    ensureChapter(chapters, finalized.chapter, finalized.chapterTitle).sections.push(finalized);
  }

  return {
    actName: detectActName(normalizedText),
    tocText,
    bodyText,
    chapters,
  };
}


