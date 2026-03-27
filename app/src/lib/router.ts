import { chatWithOllama } from "@/lib/ollama";
import { Domain } from "@/lib/types";

const DOMAIN_VALUES: Domain[] = ["citizen_law", "hr_law", "company_law"];
const DOMAIN_SET = new Set<Domain>(DOMAIN_VALUES);

function sanitizeToken(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z_]/g, "");
}

function parseDomainFromModelOutput(raw: string): Domain | null {
  const cleaned = raw.trim();

  if (DOMAIN_SET.has(cleaned as Domain)) {
    return cleaned as Domain;
  }

  const token = sanitizeToken(cleaned);
  if (DOMAIN_SET.has(token as Domain)) {
    return token as Domain;
  }

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { domain?: string };
    const fromJson = sanitizeToken(parsed.domain ?? "");
    if (DOMAIN_SET.has(fromJson as Domain)) {
      return fromJson as Domain;
    }
  } catch {
    return null;
  }

  return null;
}

function routeByKeywords(question: string): Domain | null {
  const q = question.toLowerCase();

  if (
    /\bbns\b|\bbnss\b|bharatiya\s+nyaya\s+sanhita|indian\s+penal\s+code|\bipc\b|\bcrpc\b|evidence\s+act|criminal\s+intimidation|defamation|grievous\s+hurt|human\s+body|offences?\s+against\s+women|offences?\s+against\s+child|murder|culpable\s+homicide|false\s+evidence|public\s+servant|sanhita/i.test(
      q,
    )
  ) {
    return "citizen_law";
  }

  if (
    /\bhr\b|human\s+resources|\bemployee(s)?\b|\bemployment\b|\bpayroll\b|\bleave\b|\bgratuity\b|\bpf\b|\besic\b|industrial\s+dispute/i.test(
      q,
    )
  ) {
    return "hr_law";
  }

  if (/\bcompany\b|corporate|board\s+of\s+directors?|\bdirector(s)?\b|\bmca\b|\bsebi\b|shareholder|merger|\bllp\b/i.test(q)) {
    return "company_law";
  }

  return null;
}

export async function routeQuestionToDomain(question: string): Promise<Domain> {
  const systemPrompt = [
    "You are a strict legal-domain router for an Indian legal RAG system.",
    "You must classify a user question into exactly one domain:",
    "- citizen_law: criminal law, penal code, procedure, evidence, police, courts, rights against offences.",
    "- hr_law: employment, labour, wages, PF/ESI, industrial disputes, workplace policies.",
    "- company_law: companies act, MCA filings, directors, shares, corporate compliance, mergers.",
    '{"domain":"citizen_law|hr_law|company_law"} must be the entire output.',
    "No explanation and no extra keys.",
  ].join("\n");

  const userPrompt = ["Question:", question].join("\n");

  try {
    const raw = await chatWithOllama(systemPrompt, userPrompt);
    const modelDomain = parseDomainFromModelOutput(raw);
    if (modelDomain) {
      return modelDomain;
    }
  } catch {
    // Fall through to keyword/default fallback when model routing fails.
  }

  const keywordDomain = routeByKeywords(question);
  return keywordDomain ?? "citizen_law";
}
