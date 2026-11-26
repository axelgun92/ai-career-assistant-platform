// The historical duplicate investigation (November 24, 2026) on the
// isolated test database: every stored reference examined from both sides'
// stored history, the five classes by identifier-first rules, the audit's
// opportunity count reconciled, NO_MATCH rows only counted, clusters counted
// once, the current engine's verdict, and nothing written. Reads are limited
// to this test's opportunities, so parallel test files are never touched.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import { createReadOnlyDatabaseClient, PrismaManualOpportunityRepository } from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";
import { analyzeDuplicateHistory, formatDuplicateHistoryReport, readDuplicateHistory } from "../../apps/web/src/server/duplicate-history-diagnostic";
import { createCleanup, database } from "../support/budget-integration";

const cleanup = createCleanup();
const run = randomUUID().slice(0, 8);
const manual = createManualOpportunityService({ repository: new PrismaManualOpportunityRepository(), normalizer: createManualOpportunityNormalizer() });
const reader = createReadOnlyDatabaseClient(process.env.DATABASE_URL!);
const mine = new Set<string>();

const posting = (variant: string) => [
  `Customer Success Manager (${variant}).`,
  "Own onboarding, adoption and renewals for a portfolio of mid-market SaaS customers across North America.",
  "Run quarterly business reviews, build success plans and partner with Sales and Support on expansion.",
  "Track health scores, lead escalations and turn customer feedback into product requests for the roadmap team.",
  "You bring three or more years in customer success or account management at a B2B software company.",
  "You write clearly, run a calm meeting and enjoy teaching customers to get value from the product every week.",
].join("\n");

async function opportunity(company: string, input: { location: string; text: string; url: string }) {
  const detail = await manual.submit({
    title: "Customer Success Manager",
    company: `${company} ${run}`,
    location: input.location,
    sourceUrl: input.url,
    domain: "customer-success",
    rawText: input.text,
  });
  mine.add(detail.opportunity.id);
  cleanup.opportunityIds.push(detail.opportunity.id);
  return detail.opportunity.id;
}

async function reference(later: string, earlier: string, decision: "PROBABLE_MATCH" | "NO_MATCH" = "PROBABLE_MATCH", resolution: "DISTINCT" | null = null) {
  await database.duplicateReference.create({
    data: {
      opportunityId: later, relatedOpportunityId: earlier, decision, confidence: 0.7, resolution, resolvedAt: resolution ? new Date() : null,
      evidence: { engineVersion: "core-dedup-v2", matchedOn: ["company", "title", "location", "description"], conflicts: [], sharedUrlKeys: [], sharedListingIds: [], sharedRequisitionIds: [], companyKey: null, similarity: { title: 1, location: 0.5, description: 0.7, salaryPenalty: 0 } },
    },
  });
}

afterEach(async () => {
  mine.clear();
  await cleanup.after();
});

afterAll(async () => {
  await reader.$disconnect();
  await database.$disconnect();
});

async function tableCounts() {
  return {
    opportunities: await database.opportunity.count(),
    references: await database.duplicateReference.count(),
    sourceRecords: await database.sourceRecord.count(),
    provenance: await database.fieldProvenance.count(),
    companies: await database.company.count(),
  };
}

describe("the historical duplicate investigation", () => {
  it("classifies every stored reference from both sides' stored history and writes nothing", async () => {
    const url = (name: string) => `https://jobs.example-${run}.com/${name}`;
    const ids = {
      reqA: await opportunity("Reqco", { location: "Remote - United States", text: posting("A"), url: url("req-a") }),
      reqB: await opportunity("Reqco", { location: "Remote - United States", text: posting("B"), url: url("req-b") }),
      otherReqA: await opportunity("Splitco", { location: "Remote - United States", text: posting("A"), url: url("split-a") }),
      otherReqB: await opportunity("Splitco", { location: "Remote - United States", text: posting("A"), url: url("split-b") }),
      againA: await opportunity("Againco", { location: "Remote - United States", text: posting("A"), url: url("again-a") }),
      againB: await opportunity("Againco", { location: "Remote - United States", text: posting("A"), url: url("again-b") }),
      againC: await opportunity("Againco", { location: "Remote - United States", text: posting("A"), url: url("again-c") }),
      london: await opportunity("Placeco", { location: "London, United Kingdom", text: posting("A"), url: url("london") }),
      austin: await opportunity("Placeco", { location: "Austin, Texas, United States", text: posting("A"), url: url("austin") }),
      full: await opportunity("Shortco", { location: "Remote - United States", text: posting("A"), url: url("full") }),
      short: await opportunity("Shortco", { location: "Remote - United States", text: "Customer Success Manager. Remote.", url: url("short") }),
    };
    // The employer's own requisition IDs: shared by one pair, different in another.
    await database.opportunity.updateMany({ where: { id: { in: [ids.reqA, ids.reqB] } }, data: { atsRequisitionId: `R-${run}-1` } });
    await database.opportunity.update({ where: { id: ids.otherReqA }, data: { atsRequisitionId: `R-${run}-2` } });
    await database.opportunity.update({ where: { id: ids.otherReqB }, data: { atsRequisitionId: `R-${run}-3` } });
    // Controlled references only (manual entry may have recorded its own).
    await database.duplicateReference.deleteMany({ where: { OR: [{ opportunityId: { in: [...mine] } }, { relatedOpportunityId: { in: [...mine] } }] } });
    await reference(ids.reqB, ids.reqA);
    await reference(ids.otherReqB, ids.otherReqA);
    await reference(ids.againB, ids.againA);
    await reference(ids.againC, ids.againB);
    await reference(ids.austin, ids.london, "PROBABLE_MATCH", "DISTINCT");
    await reference(ids.short, ids.full);
    await reference(ids.full, ids.againA, "NO_MATCH");

    const before = await tableCounts();
    const read = await readDuplicateHistory(reader, { limitTo: mine });
    const findings = await analyzeDuplicateHistory(read);
    const of = (later: string) => findings.find((finding) => finding.later.id === later)!;
    expect(findings).toHaveLength(6);
    expect(read.noMatchReferences).toBe(1);

    expect(of(ids.reqB)).toMatchObject({ classification: "CONFIRMED_SAME_POSTING" });
    expect(of(ids.reqB).evidence[0]).toContain("shared requisition ID");
    expect(of(ids.reqB).comparison.currentEngine).toMatchObject({ decision: "MATCH" });
    expect(of(ids.otherReqB)).toMatchObject({ classification: "CONFIRMED_DISTINCT", nature: "separate vacancies (different requisitions)" });
    expect(of(ids.againB)).toMatchObject({ classification: "LIKELY_SAME_POSTING", nature: "the same job captured again" });
    expect(of(ids.againB).comparison.description).toMatchObject({ containment: 1, jaccard: 1 });
    expect(of(ids.againC).classification).toBe("LIKELY_SAME_POSTING");
    expect(of(ids.austin)).toMatchObject({ classification: "LIKELY_DISTINCT", nature: "separate vacancies (different locations)" });
    expect(of(ids.austin).comparison.location).toBe("DIFFERS");
    expect(of(ids.short)).toMatchObject({ classification: "STILL_UNRESOLVED" });
    expect(of(ids.short).missing).toContain("a complete description (later copy incomplete)");
    expect(of(ids.short).comparison.complementary).toContain("complete description (400+ characters): only the earlier copy");
    // History: both sides' versions and first-seen period.
    expect(of(ids.againB).later.versions).toHaveLength(1);
    expect(of(ids.againB).later.versions[0]!.descriptionCharacters).toBeGreaterThan(400);

    const report = formatDuplicateHistoryReport({ database: "ai_career_assistant_test", findings, noMatchReferences: read.noMatchReferences, pairDetail: true });
    expect(report).toContain("Stored duplicate references examined (MATCH and PROBABLE_MATCH): 6");
    expect(report).toContain("PROBABLE_MATCH (resolved DISTINCT): 1");
    expect(report).toContain("NO_MATCH references (kept-separate records; not examined): 1");
    expect(report).toContain("Distinct opportunities involved: 11");
    expect(report).toMatch(/strongest reference is PROBABLE_MATCH \(the triage audit's "PROBABLE_MATCH" count is this number of opportunities, not of relationships\): 11/);
    // Againco's three copies are one cluster: counted once, two extra copies.
    expect(report).toContain("Confirmed or likely: 2 vacancies held by 5 opportunities (3 extra copies)");
    expect(report).toContain("Confirmed: 1 vacancy held by 2 opportunities (1 extra copy)");
    expect(report).toContain("Recorded as PROBABLE_MATCH but MATCH for the current engine: 1 on the stored identities, 1 on the re-normalized evidence (of 6)");
    expect(report).toContain("    CONFIRMED_SAME_POSTING: 1");
    expect(report).toContain("    STILL_UNRESOLVED: 1");
    expect(report).toContain("6. Possible current deduplication defects (identifier evidence the current engine would still not treat as a MATCH):\n    0 (none)");
    expect(report).toContain("#1 CONFIRMED_SAME_POSTING");
    expect(await tableCounts()).toEqual(before);
  });
});

describe("the duplicates:history command", () => {
  const execFileAsync = promisify(execFile);
  const cli = path.resolve("apps/web/src/server/duplicate-history-cli.ts");
  const tsx = path.resolve("node_modules/.bin/tsx");
  const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  const command = (args: string[]) =>
    execFileAsync(tsx, [cli, ...args], { env: { ...process.env }, timeout: 120_000 }).then(
      ({ stdout }) => ({ code: 0, stdout, stderr: "" }),
      (error: { code: number; stdout: string; stderr: string }) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
    );

  it("refuses another database and unknown options, and runs read-only otherwise", async () => {
    const wrong = await command(["--database", "ai_career_assistant_acceptance"]);
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toContain(`DATABASE_URL points to database "${databaseName}", not "ai_career_assistant_acceptance". Nothing was read.`);
    expect((await command(["--database", databaseName, "--merge"])).stderr).toContain("Unknown option --merge");
    const before = await tableCounts();
    const ran = await command(["--database", databaseName, "--summary-only"]);
    expect(ran.code).toBe(0);
    expect(ran.stdout).toContain("Historical duplicate investigation (read-only: nothing was written, merged, fetched or sent to a provider)");
    expect(ran.stdout).not.toContain("postgresql://");
    expect(ran.stdout).not.toContain("Pair-by-pair comparison");
    expect(await tableCounts()).toEqual(before);
  }, 240_000);
});
