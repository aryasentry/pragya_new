export type CleanedTextResult = {
  normalizedText: string;
  originalLength: number;
  normalizedLength: number;
};

const OCR_REPLACEMENTS: Array<[RegExp, string]> = [
  [/â€™/g, "'"],
  [/â€˜/g, "'"],
  [/â€œ/g, '"'],
  [/â€/g, '"'],
  [/â€”/g, "-"],
  [/â€“/g, "-"],
  [/â€¦/g, "..."],
  [/Â/g, ""],
  [/\u00a0/g, " "],
  [/\u200b/g, ""],
  [/\u200c/g, ""],
  [/\u200d/g, ""],
  [/\ufeff/g, ""],
];

function normalizeLine(line: string): string {
  return line
    .replace(/\t+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\s+$/g, "")
    .trim();
}

function stripBrokenUnicode(input: string): string {
  // Keep standard punctuation and multilingual legal text while removing control noise.
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function normalizeOcrText(rawText: string): CleanedTextResult {
  let text = stripBrokenUnicode(rawText ?? "");

  for (const [pattern, replacement] of OCR_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(/\r\n?/g, "\n");

  const normalizedLines: string[] = [];
  const lines = text.split("\n");

  for (const sourceLine of lines) {
    const line = normalizeLine(sourceLine);

    if (line.length === 0) {
      if (normalizedLines.length > 0 && normalizedLines[normalizedLines.length - 1] !== "") {
        normalizedLines.push("");
      }
      continue;
    }

    normalizedLines.push(line);
  }

  // Remove repeated blank lines.
  const compact: string[] = [];
  for (const line of normalizedLines) {
    if (line === "" && compact[compact.length - 1] === "") {
      continue;
    }
    compact.push(line);
  }

  const normalizedText = compact.join("\n").trim();

  return {
    normalizedText,
    originalLength: (rawText ?? "").length,
    normalizedLength: normalizedText.length,
  };
}

function looksLikeSectionStart(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^\d+[A-Za-z]?\.\s+/.test(trimmed) ||
    /^section\s+\d+[A-Za-z]?\b/i.test(trimmed) ||
    /^\d+[A-Za-z]?\s{2,}[A-Za-z]/.test(trimmed)
  );
}

function looksLikeChapterLine(line: string): boolean {
  return /^chapter\s+([ivxlcdm]+|\d+|[a-z])\b/i.test(line.trim());
}

function nextNonEmptyLine(lines: string[], start: number): { index: number; value: string } | null {
  for (let i = start; i < lines.length; i += 1) {
    const value = lines[i]?.trim() ?? "";
    if (value.length > 0) {
      return { index: i, value };
    }
  }
  return null;
}

export function splitTocAndBody(normalizedText: string): {
  tocText: string;
  bodyText: string;
  hasToc: boolean;
} {
  const lines = normalizedText.split("\n");
  const arrangementIndex = lines.findIndex((line) => /arrangement of sections/i.test(line));

  let bodyStart = -1;

  // Preferred path: when TOC marker exists, start searching after it so
  // numbered TOC entries do not get mistaken for statute body.
  const scanStart = arrangementIndex >= 0 ? arrangementIndex + 1 : 0;
  let firstChapterAfterArrangement = -1;
  for (let i = scanStart; i < lines.length; i += 1) {
    if (looksLikeChapterLine(lines[i] ?? "")) {
      firstChapterAfterArrangement = i;
      break;
    }
  }

  if (firstChapterAfterArrangement >= 0) {
    for (let i = firstChapterAfterArrangement + 1; i < lines.length; i += 1) {
      if (!looksLikeSectionStart(lines[i] ?? "")) {
        continue;
      }

      const next = nextNonEmptyLine(lines, i + 1);
      if (!next) {
        continue;
      }

      // Real body usually has subsection/body text after section heading.
      if (/^\(\d+[a-z]?\)|^\([a-z]\)|\b(shall|means|includes|punished|whoever)\b/i.test(next.value)) {
        bodyStart = i;
        break;
      }
    }
  }

  if (bodyStart < 0) {
    for (let i = 0; i < lines.length; i += 1) {
      if (looksLikeSectionStart(lines[i] ?? "")) {
        bodyStart = i;
        break;
      }
    }
  }

  if (bodyStart < 0) {
    return {
      tocText: "",
      bodyText: normalizedText,
      hasToc: false,
    };
  }

  const tocBoundary = arrangementIndex >= 0 ? arrangementIndex : 0;
  const tocText = bodyStart > tocBoundary ? lines.slice(0, bodyStart).join("\n").trim() : "";
  const bodyText = lines.slice(bodyStart).join("\n").trim();

  return {
    tocText,
    bodyText,
    hasToc: tocText.length > 0,
  };
}

