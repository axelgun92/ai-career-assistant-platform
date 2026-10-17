import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import {
  getDatabaseClient,
  PrismaEvaluationRepository,
  PrismaManualOpportunityRepository,
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";

const database = getDatabaseClient();
const repository = new PrismaManualOpportunityRepository();
const service = createManualOpportunityService({
  repository,
  normalizer: createManualOpportunityNormalizer(),
});
const tokens: string[] = [];

afterEach(async () => {
  for (const token of tokens.splice(0)) {
    const opportunities = await database.opportunity.findMany({
      where: { company: { name: { contains: token } } },
      select: { id: true },
    });
    const ids = opportunities.map((item) => item.id);
    await database.sourceRecord.deleteMany({
      where: { OR: [{ opportunityId: { in: ids } }, { rawDescription: { contains: token } }] },
    });
    await database.opportunity.deleteMany({ where: { id: { in: ids } } });
    await database.company.deleteMany({ where: { name: { contains: token } } });
  }
});

afterAll(() => database.$disconnect());

function newToken() {
  const token = `D${randomUUID().slice(0, 8)}`;
  tokens.push(token);
  return token;
}

function submission(token: string, overrides: Record<string, unknown> = {}) {
  return {
    rawText: [
      `Customer Success Manager at Dedupco ${token}, a SaaS workflow platform.`,
      "Own onboarding, adoption, education, retention and business reviews.",
      "Three years of Customer Success experience required.",
    ].join("\n"),
    title: "Customer Success Manager",
    company: `Dedupco ${token}`,
    location: "Remote - United States",
    domain: "customer-success",
    ...overrides,
  };
}

describe("capture-time deduplication", () => {
  it("attaches an exact re-capture to the existing opportunity instead of creating a second one", async () => {
    const token = newToken();
    const url = `https://boards.greenhouse.io/dedupco/jobs/${token}`;
    const first = await service.submit(submission(token, { sourceUrl: url, foundOn: "LinkedIn" }));
    expect(first.deduplication).toMatchObject({ outcome: "CREATED", decision: "NO_MATCH" });
    // The user moved it on and it is part of their pipeline.
    await database.opportunity.update({ where: { id: first.opportunity.id }, data: { status: "SAVED" } });
    const before = await database.opportunity.findUniqueOrThrow({ where: { id: first.opportunity.id } });

    const rawText = `Re-pasted text ${token}\nwith  different   spacing.`;
    const second = await service.submit(
      submission(token, { rawText, sourceUrl: `${url}?utm_source=newsletter`, foundOn: "A newsletter", title: "Customer Success Manager" }),
    );

    expect(second.deduplication).toMatchObject({
      outcome: "ATTACHED",
      decision: "MATCH",
      canonicalOpportunityId: first.opportunity.id,
      matches: [{ opportunityId: first.opportunity.id, decision: "MATCH", matchedOn: ["url"] }],
    });
    expect(second.opportunity.id).toBe(first.opportunity.id);
    const opportunities = await database.opportunity.count({ where: { company: { name: { contains: token } } } });
    expect(opportunities).toBe(1);

    // Both raw captures are preserved exactly; the attached one carries its decision.
    const sources = await database.sourceRecord.findMany({
      where: { opportunityId: first.opportunity.id },
      orderBy: { createdAt: "asc" },
    });
    expect(sources).toHaveLength(2);
    expect(sources[0]!.duplicateDecision).toBeNull();
    expect(sources[1]).toMatchObject({
      rawDescription: rawText,
      sourceUrl: `${url}?utm_source=newsletter`,
      duplicateDecision: "MATCH",
      duplicateEvidence: expect.objectContaining({ engineVersion: "core-dedup-v1", matchedOn: ["url"], confidence: 1 }),
    });
    expect(sources[1]!.sourceMetadata).toMatchObject({ reportedSource: "A newsletter" });

    // The canonical opportunity is unchanged except for last seen.
    const after = await database.opportunity.findUniqueOrThrow({ where: { id: first.opportunity.id } });
    const { lastSeenAt: lastSeenBefore, updatedAt: _updatedBefore, ...restBefore } = before;
    const { lastSeenAt: lastSeenAfter, updatedAt: _updatedAfter, ...restAfter } = after;
    expect(restAfter).toEqual(restBefore);
    expect(after.status).toBe("SAVED");
    expect(lastSeenAfter.getTime()).toBeGreaterThanOrEqual(lastSeenBefore.getTime());
    // No new field provenance and no duplicate reference: there is no second opportunity.
    expect(await database.fieldProvenance.count({ where: { sourceRecordId: sources[1]!.id } })).toBe(0);
    expect(await database.duplicateReference.count({ where: { opportunityId: first.opportunity.id } })).toBe(0);

    // The evaluator still reads the original capture first.
    const subject = await new PrismaEvaluationRepository().loadSubject({ opportunityId: first.opportunity.id, userProfileId: null });
    expect(subject?.rawSources[0]?.id).toBe(sources[0]!.id);
    expect(subject?.opportunity.jobDescription).toBe(first.opportunity.jobDescription);
  });

  it("attaches on the same source job ID at the same company", async () => {
    const token = newToken();
    const first = await service.submit(submission(token, { sourceJobId: `REQ-${token}` }));
    const second = await service.submit(submission(token, { sourceJobId: ` req-${token} `.toLowerCase(), company: `Dedupco ${token}, Inc.` }));
    expect(second.deduplication).toMatchObject({ outcome: "ATTACHED", matches: [{ matchedOn: ["listingId", "company"] }] });
    expect(second.opportunity.id).toBe(first.opportunity.id);
  });

  it("keeps a separate opportunity when the user says it is a different job, recorded as DISTINCT", async () => {
    const token = newToken();
    const url = `https://jobs.example.com/dedupco/${token}`;
    const first = await service.submit(submission(token, { sourceUrl: url }));
    const second = await service.submit(submission(token, { sourceUrl: url, duplicateResolution: "SEPARATE" }));

    expect(second.deduplication).toMatchObject({ outcome: "CREATED", decision: "MATCH", canonicalOpportunityId: first.opportunity.id });
    expect(second.opportunity.id).not.toBe(first.opportunity.id);
    expect(second.opportunity.status).toBe("NORMALIZED");
    const reference = await database.duplicateReference.findUniqueOrThrow({
      where: { opportunityId_relatedOpportunityId: { opportunityId: second.opportunity.id, relatedOpportunityId: first.opportunity.id } },
    });
    expect(reference).toMatchObject({ decision: "MATCH", resolution: "DISTINCT" });
    expect(reference.resolvedAt).toBeInstanceOf(Date);
    expect(reference.evidence).toMatchObject({ recordedBy: "CAPTURE_KEPT_SEPARATE" });
  });

  it("creates the opportunity and records a warning for a probable match", async () => {
    const token = newToken();
    const first = await service.submit(submission(token));
    const second = await service.submit(submission(token, { title: "Senior Customer Success Manager" }));

    expect(second.deduplication).toMatchObject({ outcome: "CREATED", decision: "PROBABLE_MATCH", canonicalOpportunityId: null });
    expect(second.opportunity.id).not.toBe(first.opportunity.id);
    const reference = await database.duplicateReference.findFirstOrThrow({ where: { opportunityId: second.opportunity.id } });
    expect(reference).toMatchObject({ relatedOpportunityId: first.opportunity.id, decision: "PROBABLE_MATCH", resolution: null });
    expect(Number(reference.confidence)).toBeGreaterThanOrEqual(0.6);
    expect(reference.evidence).toMatchObject({ recordedBy: "CAPTURE", similarity: expect.any(Object) });
  });

  it("records nothing for an unrelated capture", async () => {
    const token = newToken();
    await service.submit(submission(token));
    const other = await service.submit(submission(token, { title: "Implementation Engineer", rawText: `Build integrations ${token} for enterprise accounts.` }));
    expect(other.deduplication).toMatchObject({ outcome: "CREATED", decision: "NO_MATCH", matches: [] });
    expect(await database.duplicateReference.count({ where: { opportunityId: other.opportunity.id } })).toBe(0);
  });

  it("serializes simultaneous identical captures into one opportunity with every source kept", async () => {
    const token = newToken();
    const url = `https://jobs.example.com/race/${token}`;
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) => service.submit(submission(token, { sourceUrl: url, rawText: `Capture ${index} ${token}` }))),
    );
    const ids = new Set(results.map((result) => result.opportunity.id));
    expect(ids.size).toBe(1);
    expect(results.filter((result) => result.deduplication.outcome === "CREATED")).toHaveLength(1);
    expect(await database.sourceRecord.count({ where: { opportunityId: [...ids][0] } })).toBe(10);
    expect(await database.company.count({ where: { name: { contains: token } } })).toBe(1);
  });

  it("checks duplicates without writing", async () => {
    const token = newToken();
    const url = `https://jobs.example.com/check/${token}`;
    const first = await service.submit(submission(token, { sourceUrl: url }));
    const counts = async () => [
      await database.sourceRecord.count(),
      await database.opportunity.count(),
      await database.company.count(),
      await database.duplicateReference.count(),
    ];
    const before = await counts();
    await expect(service.checkDuplicates(submission(token, { sourceUrl: url }))).resolves.toMatchObject({
      decision: "MATCH",
      canonicalOpportunityId: first.opportunity.id,
      matches: [{ opportunityId: first.opportunity.id, title: "Customer Success Manager", companyName: `Dedupco ${token}` }],
    });
    expect(await counts()).toEqual(before);
  });

  it("rolls back the raw SourceRecord with everything else when the ingest transaction fails", async () => {
    const token = newToken();
    const normalizer = createManualOpportunityNormalizer();
    const failing = createManualOpportunityService({
      repository,
      normalizer: {
        async normalize(raw) {
          const result = await normalizer.normalize(raw);
          // Valid for the normalized contract but too large for the
          // Decimal(12, 2) column: the database rejects the opportunity
          // insert, inside the transaction and after the SourceRecord insert.
          return { ...result, opportunity: { ...result.opportunity, salaryMin: 1e13 } };
        },
      },
    });
    await expect(failing.submit(submission(token))).rejects.toThrow();
    expect(await database.sourceRecord.count({ where: { rawDescription: { contains: token } } })).toBe(0);
    expect(await database.opportunity.count({ where: { company: { name: { contains: token } } } })).toBe(0);
    expect(await database.company.count({ where: { name: { contains: token } } })).toBe(0);
  });

  it("still preserves the raw capture, unlinked, when normalization fails", async () => {
    const token = newToken();
    await expect(
      createManualOpportunityService({
        repository,
        normalizer: { normalize: async () => { throw new Error("normalization failed"); } },
      }).submit(submission(token)),
    ).rejects.toThrow("normalization failed");
    const preserved = await database.sourceRecord.findMany({ where: { rawDescription: { contains: token } } });
    expect(preserved).toHaveLength(1);
    expect(preserved[0]!.opportunityId).toBeNull();
  });
});

describe("company normalization and reuse", () => {
  it("reuses one company across spellings and keeps what the user typed in the source data", async () => {
    const token = newToken();
    const first = await service.submit(submission(token, { company: `Dedupco ${token}, Inc.`, title: "Role A", rawText: `Role A ${token}` }));
    const second = await service.submit(submission(token, { company: `  DEDUPCO ${token.toLowerCase()} `, title: "Role B", rawText: `Role B ${token} different work` }));

    const [a, b] = await Promise.all([
      database.opportunity.findUniqueOrThrow({ where: { id: first.opportunity.id }, include: { company: true, sourceRecords: true, fieldProvenance: true } }),
      database.opportunity.findUniqueOrThrow({ where: { id: second.opportunity.id }, include: { company: true, sourceRecords: true, fieldProvenance: true } }),
    ]);
    expect(b.companyId).toBe(a.companyId);
    expect(a.company).toMatchObject({ name: `Dedupco ${token}, Inc.`, normalizedName: `dedupco ${token.toLowerCase()}` });
    // The canonical display name is the stored one; the typed spelling is preserved.
    expect(second.opportunity.companyName).toBe(`Dedupco ${token}, Inc.`);
    expect(b.sourceRecords[0]!.rawCompany).toBe(`  DEDUPCO ${token.toLowerCase()} `);
    expect(b.fieldProvenance.find((item) => item.fieldName === "company.name")?.sourceText).toBe(`  DEDUPCO ${token.toLowerCase()} `);
  });

  it("reuses a company that has not been backfilled without changing it", async () => {
    const token = newToken();
    const legacy = await database.company.create({ data: { name: `Dedupco ${token} LLC` } });
    const captured = await service.submit(submission(token, { company: `dedupco ${token}` }));
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: captured.opportunity.id } });
    expect(opportunity.companyId).toBe(legacy.id);
    expect(await database.company.findUniqueOrThrow({ where: { id: legacy.id } })).toEqual(legacy);
  });

  it("creates a new company with its normalized name when none matches", async () => {
    const token = newToken();
    const captured = await service.submit(submission(token, { company: `Fresh & Co ${token} GmbH` }));
    const opportunity = await database.opportunity.findUniqueOrThrow({ where: { id: captured.opportunity.id }, include: { company: true } });
    expect(opportunity.company).toMatchObject({ name: `Fresh & Co ${token} GmbH`, normalizedName: `fresh and co ${token.toLowerCase()}` });
  });
});
