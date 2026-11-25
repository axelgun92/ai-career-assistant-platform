// Explicit position evidence in a listing's own text (November 25, 2026),
// for hard-requirement triage: whether the role states people-management
// duties, and whether it states a full-time schedule. Deterministic phrase
// readings of the stored title and complete job description; each returns
// the sentence it read, so a decision can quote it. Nothing is inferred from
// years of experience, the company, or the absence of a statement.

export interface PositionEvidenceFact {
  sourceText: string;
}

export interface PositionEvidence {
  // "You will manage a team of five CSMs", "3 direct reports", "people
  // manager": the role manages people. Null when not stated.
  peopleManagement: PositionEvidenceFact | null;
  // "This is a full-time contract role", "40 hours per week": a full-time
  // schedule is stated. Null when not stated, or when a part-time schedule
  // is stated as well.
  fullTimeSchedule: PositionEvidenceFact | null;
}

const peopleManagementPatterns = [
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+direct\s+reports?\b/i,
  /\b(?:have|has|with|manage|managing|oversee|overseeing)\s+(?:\w+\s+){0,3}direct\s+reports?\b/i,
  /\b(?:manage|managing|lead|leading|build|building|grow|growing|oversee|overseeing|supervise|supervising|run|running)\s+(?:and\s+(?:lead|manage|grow|develop)\s+)?(?:a|the|our|your)\s+(?:\w+\s+){0,3}team\s+of\s+(?:\d+|\w+)\b/i,
  /\b(?:people|line)\s+manag(?:er|ement)\b/i,
  /\b(?:hire|hiring|recruit),?\s+(?:and\s+)?(?:coach|develop|mentor|manage)\s+(?:a\s+team|the\s+team|your\s+team|team\s+members|customer\s+success\s+managers|csms)\b/i,
  /\bperformance\s+reviews?\s+for\s+(?:your|the|a)\s+team\b/i,
];

const fullTimePattern = /\bfull[- ]?time\b|\b(?:3[5-9]|40)\s*(?:hours?|hrs?)\s*(?:\/|per|a)\s*(?:week|wk)\b/i;
const partTimePattern = /\bpart[- ]?time\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+|\s+[•·▪]\s+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length > 0 && sentence.length <= 400);
}

// A statement that is negated ("no direct reports", "not a people manager")
// is not evidence.
const negated = /\b(?:no|not|without|never|none)\b[^.]{0,30}$/i;

function firstMatch(texts: readonly string[], patterns: readonly RegExp[]): PositionEvidenceFact | null {
  for (const text of texts) {
    for (const sentence of sentences(text)) {
      for (const pattern of patterns) {
        const match = pattern.exec(sentence);
        if (match && !negated.test(sentence.slice(0, match.index))) return { sourceText: sentence.slice(0, 240) };
      }
    }
  }
  return null;
}

export function readPositionEvidence(input: { title: string | null; description: string | null }): PositionEvidence {
  const texts = [input.title ?? "", input.description ?? ""].filter((text) => text.trim().length > 0);
  const fullTime = firstMatch(texts, [fullTimePattern]);
  const partTime = firstMatch(texts, [partTimePattern]);
  return {
    peopleManagement: firstMatch(input.description ? [input.description] : [], peopleManagementPatterns),
    fullTimeSchedule: fullTime && !partTime ? fullTime : null,
  };
}
