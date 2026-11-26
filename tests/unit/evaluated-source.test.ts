// The evaluated source version (Core TDD §51, v1.15): domain stages read the
// source record an evaluation is bound to, never simply the oldest record.
import { describe, expect, it } from "vitest";
import { evaluatedSource } from "@ai-career/evaluation";

const source = (id: string, rawDescription: string) => ({ id, source: "test-ats", sourceType: "ATS" as const, sourceUrl: null, rawDescription, rawPayload: null });
const rawSources = [source("v1", "First version"), source("v2", "Second version"), source("v3", "Third version")];

describe("evaluatedSource", () => {
  it("returns the bound version, not rawSources[0]", () => {
    expect(evaluatedSource({ rawSources, subjectSourceRecordId: "v3" })).toBe(rawSources[2]);
    expect(evaluatedSource({ rawSources, subjectSourceRecordId: "v2" })!.rawDescription).toBe("Second version");
  });

  it("falls back to the first record only when no version is bound or the bound one is absent", () => {
    expect(evaluatedSource({ rawSources, subjectSourceRecordId: null })).toBe(rawSources[0]);
    expect(evaluatedSource({ rawSources, subjectSourceRecordId: "missing" })).toBe(rawSources[0]);
    expect(evaluatedSource({ rawSources: [], subjectSourceRecordId: "v1" })).toBeUndefined();
  });
});
