// The Mode A / Mode B parity contract (November 8, 2026), on the isolated test
// database. The same job page is captured through each real path:
// - Mode A, Single Capture: the extension's reader output sent to the
//   single-job capture service (createExtensionCaptureService.capture);
// - Mode B, Batch Capture: one results-page save (createPageCaptureService),
//   then the retrieval worker's automatic pass (createPageCaptureAcquisition:
//   the page read by the same reader, LinkedIn without its scripts, the
//   incomplete-page check, the shared ingestor).
// Both must persist the same normalized facts, the same current provenance,
// the same source version (content hash and material fields) and the same
// user-facing Salary, arrangement and eligibility displays. Only the capture
// method, pairing and worker version (provenance) may differ.
//
// Then the duplicate contract (Core Platform TDD v1.20, Section 51, including
// the D1 change approved on November 8, 2026): an exact recapture reuses the job;
// an unchanged recapture adds no version, and only corrects saved facts the
// current normalization reads differently from the same evidence (D1),
// once; changed evidence adds one version and updates the current facts,
// keeping what the new version does not contradict and all history; a
// similar listing with its own identifier is a possible duplicate, never
// merged; two different jobs at one company stay two jobs.
//
// Pages: the three real November 7 LinkedIn pages (reduced; no network) and
// synthetic LinkedIn guest pages for the Salary display contract. Nothing
// reaches any site; no profile, evaluation or provider call.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { correctedFactLabels, createRetrievalIngestionService, extensionCaptureSchemaVersion, geographyName } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import { findListingVersionHint, PrismaExtensionLookupRepository, PrismaManualOpportunityRepository, PrismaPageCaptureRepository } from "@ai-career/database";
import type { BrowserDriver } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { JSDOM } from "jsdom";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import {
  formatArrangementWithExceptions,
  formatResidencyEligibility,
  formatSalary,
  formatWorkAuthorization,
  formatWorkArrangements,
} from "../../apps/web/src/components/opportunity-facts";
import { createExtensionCaptureService, parseCapture } from "../../apps/web/src/server/extension-capture";
import { createPageCaptureService } from "../../apps/web/src/server/page-capture";
import { createPageCaptureAcquisition, createPageCaptureIngestor, readJobPage } from "../../apps/web/src/server/page-capture-acquisition";
import { database } from "../support/budget-integration";
import { linkedInGuestJobPage } from "../support/linkedin-guest-pages";

const clock = { now: new Date("2026-11-08T10:00:00.000Z") };
const ingestion = createRetrievalIngestionService({ repository: new PrismaManualOpportunityRepository(), normalizer: createRetrievedOpportunityNormalizer() });
const repository = new PrismaPageCaptureRepository();
const singleJob = createExtensionCaptureService({
  ingestion,
  lookup: new PrismaExtensionLookupRepository(),
  latestEvaluation: async () => null,
  discovery: customerSuccessDiscoveryConfiguration,
  now: () => clock.now,
});
const intake = createPageCaptureService({ repository, enabledSites: () => ({ cards: ["linkedin"], details: ["linkedin"] }), now: () => clock.now });

// The pages, served by a fixture browser (the worker's path) and read by the
// extension's reader (the single-job path).
const pages = new Map<string, string>();
const navigated: string[] = [];
const driver: BrowserDriver = {
  async navigate(url) {
    navigated.push(url);
    const html = pages.get(url);
    if (!html) return { status: 404, finalUrl: url, html: "<html><body>Not found</body></html>", cookieNames: [] };
    return { status: 200, finalUrl: url, html, servedHtml: html, cookieNames: [], requests: { pageScripts: "skip", documentRequests: 1, redirects: 0, sentRequests: 1, blockedRequests: 0, blockedByType: {} } };
  },
  close: async () => undefined,
};
const launches: unknown[] = [];
// Evaluation requests the worker made (D1 must never make one).
const handoffs: string[] = [];
const acquisition = createPageCaptureAcquisition({
  repository,
  ingestion,
  handoff: {
    alreadyHandled: async () => false,
    request: async () => {
      handoffs.push("request");
      return "NO_ACTIVE_PROFILE";
    },
  },
  discovery: customerSuccessDiscoveryConfiguration,
  detailSites: () => ["linkedin"],
  browser: {
    launch: async (options) => {
      launches.push(options);
      return driver;
    },
  },
  now: () => clock.now,
  sleep: async () => undefined,
});

const jobUrl = (id: string) => `https://www.linkedin.com/jobs/view/${id}`;
const touched = new Set<string>();

// Removes everything these tests stored for the listings (jobs, versions,
// provenance, staged items, sessions, companies left without jobs).
async function purge(ids: Iterable<string>) {
  const externalIds = [...ids].map((id) => `linkedin:${id}`);
  const items = await database.pageCaptureItem.findMany({ where: { externalId: { in: externalIds } }, select: { id: true, opportunityId: true } });
  const records = await database.sourceRecord.findMany({ where: { externalId: { in: externalIds } }, select: { opportunityId: true } });
  const opportunityIds = [...new Set([...items, ...records].map((row) => row.opportunityId).filter((id): id is string => Boolean(id)))];
  await database.pageCaptureItem.deleteMany({ where: { externalId: { in: externalIds } } });
  await database.$executeRaw`DELETE FROM "PageCaptureSession" s WHERE NOT EXISTS (SELECT 1 FROM "PageCaptureItem" i WHERE i."id" = ANY(s."itemIds"))`;
  const companies = await database.opportunity.findMany({ where: { id: { in: opportunityIds } }, select: { companyId: true } });
  for (;;) {
    const leaves = await database.sourceRecord.findMany({ where: { OR: [{ opportunityId: { in: opportunityIds } }, { externalId: { in: externalIds } }], laterObservations: { none: {} } }, select: { id: true } });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  await database.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
  for (const { companyId } of companies) {
    if (companyId && !(await database.opportunity.count({ where: { companyId } }))) await database.company.deleteMany({ where: { id: companyId } });
  }
}

let pairing: { id: string; label: string; tokenHint: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
beforeEach(async () => {
  pairing = await database.extensionPairing.create({ data: { label: `Parity ${randomUUID()}`, tokenHash: randomUUID(), tokenHint: "test" } });
  navigated.splice(0);
  launches.splice(0);
  handoffs.splice(0);
  pages.clear();
});
afterEach(async () => {
  await purge(touched);
  touched.clear();
  await database.extensionPairing.deleteMany({ where: { id: pairing.id } });
  clock.now = new Date("2026-11-08T10:00:00.000Z");
});
afterAll(() => database.$disconnect());

// Mode A: what the extension sends from the page (its reader, as in Chrome).
function singleCaptureEnvelope(id: string, html: string) {
  const document = new JSDOM(html, { url: jobUrl(id), runScripts: "outside-only" }).window.document;
  const extraction = readJobPage(document);
  const built = buildCaptureEnvelope({ ...extraction!, pageUrl: jobUrl(id) }, "page", { extensionVersion: "0.3.0", capturedAt: clock.now });
  if (!built.ok) throw new Error(`no capture for ${id}: ${built.problems.join("; ")}`);
  expect(built.envelope.schemaVersion).toBe(extensionCaptureSchemaVersion);
  return built.envelope;
}

async function captureModeA(id: string, html: string) {
  touched.add(id);
  const { result } = await singleJob.capture(singleCaptureEnvelope(id, html), pairing);
  return result;
}

async function captureModeB(ids: string[]) {
  for (const id of ids) touched.add(id);
  const staged = await intake.capture(
    {
      schemaVersion: 1,
      kind: "page-capture",
      batchId: randomUUID(),
      site: "linkedin",
      pageUrl: "https://www.linkedin.com/jobs/search/?keywords=customer%20success",
      pageTitle: "Customer Success jobs",
      capturedAt: clock.now.toISOString(),
      extensionVersion: "0.3.0",
      counts: { loaded: ids.length, skippedUnloaded: 0, overCap: 0 },
      cards: ids.map((id) => ({ url: jobUrl(id), title: "Customer Success Manager", siteJobId: id, company: null, location: null })),
    },
    pairing,
  );
  const pass = await acquisition.runOnce();
  return { staged, pass };
}

const factFields = [
  "title", "location", "remoteStatus", "workArrangements", "timeZoneRequirements", "residencyRequirement", "residencyRegions", "residencyExclusions",
  "workAuthorizationRequirement", "workAuthorizationRegions", "visaSponsorship", "relocationSupport", "employerOfRecordRegions",
  "salaryMin", "salaryMax", "salaryText", "compensationBasis", "compensationTiers", "currency", "employmentType", "seniority", "seniorityLabel",
  "postingDate", "closingDate", "applicationUrl", "canonicalUrl", "externalListingId", "jobDescription", "source", "sourceType",
] as const;

// Everything a user or the evaluator sees of the job, as stored.
async function snapshot(opportunityId: string) {
  const stored = await database.opportunity.findUniqueOrThrow({ where: { id: opportunityId }, include: { company: { select: { name: true } } } });
  // Amounts as the product's read models give them (numbers, not Decimal).
  const opportunity = { ...stored, salaryMin: stored.salaryMin?.toNumber() ?? null, salaryMax: stored.salaryMax?.toNumber() ?? null };
  const provenance = await database.fieldProvenance.findMany({ where: { opportunityId, supersededAt: null }, orderBy: [{ fieldName: "asc" }, { sourceField: "asc" }] });
  const versions = await database.sourceRecord.findMany({ where: { opportunityId }, orderBy: { createdAt: "asc" } });
  const facts = Object.fromEntries(factFields.map((field) => [field, (opportunity as Record<string, unknown>)[field]]));
  const rows = provenance.map((row) => ({ fieldName: row.fieldName, sourceField: row.sourceField, kind: row.kind, sourceText: row.sourceText, normalizedValue: row.normalizedValue }));
  const shown = {
    salary: formatSalary(opportunity) ?? "Unknown",
    arrangement: formatArrangementWithExceptions(opportunity as never, provenance),
    arrangements: formatWorkArrangements(opportunity),
    residency: formatResidencyEligibility(opportunity.residencyRequirement, opportunity.residencyRegions, opportunity.residencyExclusions),
    authorization: formatWorkAuthorization(opportunity, geographyName),
  };
  const evidence = versions.map((version) => ({
    contentHash: version.contentHash,
    rawTitle: version.rawTitle,
    rawCompany: version.rawCompany,
    rawLocation: version.rawLocation,
    rawDescription: version.rawDescription,
    rawSalaryText: version.rawSalaryText,
    applicationUrl: version.applicationUrl,
    readQuality: (version.sourceMetadata as { capture?: { readQuality?: string } } | null)?.capture?.readQuality ?? null,
  }));
  return { company: opportunity.company?.name ?? null, facts, provenance: rows, shown, evidence };
}

const realPages = JSON.parse(readFileSync("tests/fixtures/real-captures/linkedin-nov7-job-pages.json", "utf8")) as { pages: Record<string, { listingId: string; html: string }> };

// Synthetic LinkedIn guest pages, one per Salary arrangement, each with the
// other facts a posting can state.
const statedFacts = [
  "<p>This is a fully remote role. Candidates must reside in the United States; we are unable to hire in Alaska, Hawaii or Montana.</p>",
  "<p>You must be authorized to work in the United States. We are unable to sponsor visas.</p>",
  "<p>Working hours overlap with Eastern Time (ET) is required.</p>",
  "<p>Applications close on December 15, 2026.</p>",
  "<p>Own onboarding, adoption, renewals and expansion for a portfolio of mid-market SaaS customers, running business reviews and success plans with each customer's stakeholders.</p>",
].join("");
const salaryPages = {
  "4490000001": { statement: "Base salary of $80,000–$100,000.", shown: "$80,000–$100,000 USD (Base salary)" },
  "4490000002": { statement: "Target total cash compensation of $106,400–$197,600, including base salary and target incentives.", shown: "$106,400–$197,600 USD (Target total cash: base + incentives)" },
  "4490000003": { statement: "Compensation: $70,000 base salary plus commission.", shown: "$70,000 USD base + commission" },
  "4490000004": { statement: "The salary range is $90,000–$120,000, including bonuses.", shown: "$90,000–$120,000 USD (Includes bonuses)" },
} as const;
const syntheticPage = (id: string, statement: string, extra = "") =>
  linkedInGuestJobPage({ id, title: "Customer Success Manager", company: `Parity Co ${id}`, location: "United States", descriptionHtml: `${statedFacts}<p>${statement}</p>${extra}`, seniority: "Mid-Senior level", employmentType: "Full-time", posted: "3 days ago" });

async function bothModes(id: string, html: string) {
  await purge([id]);
  pages.set(jobUrl(id), html);
  const single = await captureModeA(id, html);
  expect(single.outcome).toBe("CREATED");
  const viaSingle = await snapshot(single.opportunityId);
  await purge([id]);
  const { staged, pass } = await captureModeB([id]);
  expect(staged.counts).toMatchObject({ queued: 1 });
  expect(pass).toMatchObject({ ingested: 1, incomplete: 0, pageScripts: "skip" });
  const item = await database.pageCaptureItem.findFirstOrThrow({ where: { externalId: `linkedin:${id}` } });
  const viaBatch = await snapshot(item.opportunityId!);
  return { viaSingle, viaBatch };
}

describe("Mode A and Mode B store the same job from the same page", () => {
  for (const [name, page] of Object.entries(realPages.pages)) {
    it(`the real November 7 page (${name}): the same facts, provenance, source version and displays`, async () => {
      const { viaSingle, viaBatch } = await bothModes(page.listingId, page.html);
      expect(viaBatch).toEqual(viaSingle);
      expect(launches).toEqual([{ pageScripts: "skip" }]);
    });
  }

  for (const [id, salary] of Object.entries(salaryPages)) {
    it(`Salary "${salary.shown}": the same in both modes, with every stated fact`, async () => {
      const { viaSingle, viaBatch } = await bothModes(id, syntheticPage(id, salary.statement));
      expect(viaBatch).toEqual(viaSingle);
      expect(viaSingle.shown).toEqual({
        salary: salary.shown,
        arrangement: "Remote",
        arrangements: "Remote",
        residency: "U.S. residence required, excluding: Alaska, Hawaii, Montana",
        authorization: viaSingle.shown.authorization,
      });
      expect(viaSingle.facts).toMatchObject({ visaSponsorship: "NOT_AVAILABLE", workAuthorizationRequirement: "RIGHT_TO_WORK", employmentType: "FULL_TIME", applicationUrl: jobUrl(id) });
      expect(viaSingle.facts.closingDate).toEqual(new Date("2026-12-15T00:00:00.000Z"));
      expect(viaSingle.facts.timeZoneRequirements).toBeTruthy();
      // The employer's own wording stays the evidence of the Salary.
      expect(viaSingle.facts.salaryText).toBe(salary.statement);
      expect(viaSingle.provenance.find((row) => row.fieldName === "salaryText")?.sourceText).toBe(salary.statement);
    });
  }
});

describe("exact and possible duplicates, and source updates (both modes)", () => {
  const id = "4490000011";
  const page = (statement: string, extra = "") => syntheticPage(id, statement, extra);

  it("an exact recapture reuses the job; an unchanged one changes nothing and adds no version, in either mode", async () => {
    await purge([id]);
    pages.set(jobUrl(id), page("Base salary of $80,000–$100,000."));
    const first = await captureModeA(id, pages.get(jobUrl(id))!);
    const before = await snapshot(first.opportunityId);
    const jobs = await database.opportunity.count();
    // Mode A again, then Mode B (the same listing on a results page).
    clock.now = new Date("2026-11-08T11:00:00.000Z");
    const again = await captureModeA(id, pages.get(jobUrl(id))!);
    expect(again).toMatchObject({ outcome: "UNCHANGED", opportunityId: first.opportunityId });
    clock.now = new Date("2026-11-08T12:00:00.000Z");
    const { staged } = await captureModeB([id]);
    // Saved already and read by the current reader: not read again.
    expect(staged.counts).toMatchObject({ alreadySaved: 1, queued: 0 });
    expect(navigated).toEqual([]);
    expect(await database.opportunity.count()).toBe(jobs);
    const after = await snapshot(first.opportunityId);
    expect(after).toEqual(before);
    expect(after.evidence).toHaveLength(1);
    const job = await database.opportunity.findUniqueOrThrow({ where: { id: first.opportunityId } });
    expect(job.lastSeenAt.toISOString()).toBe("2026-11-08T11:00:00.000Z");
  });

  it("changed evidence adds one version and updates the current facts; what it does not contradict, and every earlier version, stay", async () => {
    await purge([id]);
    const first = await captureModeA(id, page("Base salary of $80,000–$100,000."));
    // The employer changes the pay statement (and nothing else).
    clock.now = new Date("2026-11-08T11:00:00.000Z");
    const changed = await captureModeA(id, page("Compensation: $70,000 base salary plus commission."));
    expect(changed).toMatchObject({ outcome: "CHANGED", opportunityId: first.opportunityId });
    const after = await snapshot(first.opportunityId);
    expect(after.evidence).toHaveLength(2);
    expect(after.shown.salary).toBe("$70,000 USD base + commission");
    // Everything else the posting still states is kept.
    expect(after.shown).toMatchObject({ arrangement: "Remote", residency: "U.S. residence required, excluding: Alaska, Hawaii, Montana" });
    expect(after.facts).toMatchObject({ visaSponsorship: "NOT_AVAILABLE", closingDate: new Date("2026-12-15T00:00:00.000Z") });
    // The superseded salary evidence is history, not deleted.
    const history = await database.fieldProvenance.findMany({ where: { opportunityId: first.opportunityId, fieldName: "salaryText" }, orderBy: { createdAt: "asc" } });
    expect(history.map((row) => [row.sourceText, row.supersededAt !== null])).toEqual([
      ["Base salary of $80,000–$100,000.", true],
      ["Compensation: $70,000 base salary plus commission.", false],
    ]);
  });

  it("a read that no longer states a field keeps the saved value (weaker evidence never erases it)", async () => {
    await purge([id]);
    const first = await captureModeA(id, page("Base salary of $80,000–$100,000."));
    // The same posting, its pay statement missing from this read.
    clock.now = new Date("2026-11-08T11:00:00.000Z");
    const changed = await captureModeA(id, page("Pay is discussed during interviews."));
    expect(changed.outcome).toBe("CHANGED");
    const after = await snapshot(first.opportunityId);
    expect(after.shown.salary).toBe("$80,000–$100,000 USD (Base salary)");
    expect(after.evidence).toHaveLength(2);
  });

  it("a similar listing with its own LinkedIn ID is a possible duplicate, flagged and never merged; a different job at the same company stays separate", async () => {
    const similar = "4490000012";
    const different = "4490000013";
    await purge([id, similar, different]);
    const company = `Parity Co ${id}`;
    const description = `${statedFacts}<p>Base salary of $80,000–$100,000.</p>`;
    const original = await captureModeA(id, linkedInGuestJobPage({ id, title: "Customer Success Manager", company, location: "United States", descriptionHtml: description }));
    // The same role posted again under another listing ID (a near-identical
    // description), and a different role at the same company.
    const repost = await captureModeA(similar, linkedInGuestJobPage({ id: similar, title: "Customer Success Manager", company, location: "United States", descriptionHtml: `${description}<p>Apply today.</p>` }));
    const other = await captureModeA(
      different,
      linkedInGuestJobPage({ id: different, title: "Implementation Engineer", company, location: "United States", descriptionHtml: "<p>Configure integrations and data migrations for new customers, working with engineering on technical onboarding and API questions every week.</p>" }),
    );
    expect(original.outcome).toBe("CREATED");
    expect(repost).toMatchObject({ outcome: "CREATED", probableDuplicate: true });
    expect(repost.opportunityId).not.toBe(original.opportunityId);
    expect(other).toMatchObject({ outcome: "CREATED", probableDuplicate: false });
    expect(new Set([original.opportunityId, repost.opportunityId, other.opportunityId]).size).toBe(3);
    // Each keeps its own source version and facts; nothing is merged.
    for (const job of [original, repost, other]) expect((await snapshot(job.opportunityId)).evidence).toHaveLength(1);
    // Captured again (re-normalized under D1): the same jobs, the possible
    // duplicate still flagged as it was, still not merged.
    const references = () =>
      database.duplicateReference.findMany({ where: { OR: [{ opportunityId: { in: [original.opportunityId, repost.opportunityId] } }, { relatedOpportunityId: { in: [original.opportunityId, repost.opportunityId] } }] }, orderBy: { id: "asc" } });
    const flagged = await references();
    expect(flagged.length).toBeGreaterThan(0);
    const jobs = await database.opportunity.count();
    expect(await captureModeA(id, linkedInGuestJobPage({ id, title: "Customer Success Manager", company, location: "United States", descriptionHtml: description }))).toMatchObject({ outcome: "UNCHANGED", opportunityId: original.opportunityId });
    expect(await captureModeA(similar, linkedInGuestJobPage({ id: similar, title: "Customer Success Manager", company, location: "United States", descriptionHtml: `${description}<p>Apply today.</p>` }))).toMatchObject({ outcome: "UNCHANGED", opportunityId: repost.opportunityId });
    expect(await database.opportunity.count()).toBe(jobs);
    expect(await references()).toEqual(flagged);
  });
});

// D1 (approved November 8, 2026): a job saved by an earlier normalizer and
// captured again with the same evidence (Single Capture, or an eligible Mode
// B refresh) is normalized again by the current rules. Genuinely supported
// differences are corrected on the same job, from the same source version (no
// new version), with provenance citing it; user corrections, another
// source's evidence and facts the current read does not state are kept; a
// repeat changes nothing; nothing is evaluated. A changed posting still adds
// a version. A job saved by an earlier normalizer is simulated by storing
// what that normalizer produced (test setup only).
type StoredFacts = Parameters<typeof database.opportunity.update>[0]["data"];
async function savedByEarlierNormalizer(opportunityId: string, stored: StoredFacts, statedText: Partial<Record<string, string>> = {}) {
  await database.opportunity.update({ where: { id: opportunityId }, data: stored });
  for (const field of Object.keys(stored)) {
    const value = (stored as Record<string, unknown>)[field];
    const empty = value === null || (Array.isArray(value) && value.length === 0);
    if (empty) {
      // The earlier normalizer stated nothing for it: no current evidence.
      await database.fieldProvenance.updateMany({ where: { opportunityId, fieldName: field, supersededAt: null }, data: { supersededAt: new Date("2026-11-05T20:15:30.000Z") } });
    } else {
      await database.fieldProvenance.updateMany({
        where: { opportunityId, fieldName: field, supersededAt: null },
        data: { normalizedValue: JSON.parse(JSON.stringify(value)), ...(statedText[field] ? { sourceText: statedText[field] } : {}) },
      });
    }
  }
}
// The saved read made by an earlier reader (revision 0, as the November 5–7
// records), so a later results-page save refreshes it (Mode B rule R1).
async function readByEarlierReader(opportunityId: string) {
  const record = await database.sourceRecord.findFirstOrThrow({ where: { opportunityId } });
  const metadata = record.sourceMetadata as Record<string, Record<string, unknown>>;
  delete (metadata as Record<string, unknown>).lastRead;
  await database.sourceRecord.update({ where: { id: record.id }, data: { sourceMetadata: { ...metadata, capture: { ...metadata.capture, readerRevision: 0 } } } });
}
const corrections = async (opportunityId: string) =>
  ((await database.sourceRecord.findFirstOrThrow({ where: { opportunityId }, orderBy: { createdAt: "asc" } })).sourceMetadata as { normalizationCorrections?: Array<{ fields: string[] }> })
    .normalizationCorrections ?? [];
const evaluationsOf = (opportunityId: string) => database.evaluation.count({ where: { opportunityId } });

describe("D1: a job saved before a normalization correction, captured again with the same evidence", () => {
  const id = "4490000021";
  const statement =
    "The target total cash compensation range for this role is $106,400 USD - $197,600 USD. Pay is positioned within the range based on several factors. Target total cash compensation ranges are inclusive of both base pay and any target sales incentive.";
  const firstSentence = "The target total cash compensation range for this role is $106,400 USD - $197,600 USD.";
  const shownNow = "$106,400–$197,600 USD (Target total cash: base + incentives)";
  // The statement as read now: the range and the sentence defining it.
  const readNow = `${firstSentence} Target total cash compensation ranges are inclusive of both base pay and any target sales incentive.`;
  // As saved on November 7 (Thomson Reuters' wording): no basis, and the
  // defining sentence not part of the statement.
  const earlier = { compensationBasis: null, salaryText: firstSentence };

  async function saved() {
    await purge([id]);
    const first = await captureModeA(id, syntheticPage(id, statement));
    await savedByEarlierNormalizer(first.opportunityId, earlier, { salaryText: firstSentence });
    expect((await snapshot(first.opportunityId)).shown.salary).toBe("$106,400–$197,600 USD (Target total cash)");
    return first.opportunityId;
  }

  it("Single Capture: corrected on the same job from the same version, provenance citing it; a repeat changes nothing", async () => {
    const opportunityId = await saved();
    const before = await snapshot(opportunityId);
    const jobs = await database.opportunity.count();
    clock.now = new Date("2026-11-08T11:00:00.000Z");
    const again = await captureModeA(id, syntheticPage(id, statement));
    expect(again).toMatchObject({ outcome: "UNCHANGED", opportunityId, normalizationCorrected: ["Salary"] });
    const after = await snapshot(opportunityId);
    // The same source version: no new one, its evidence untouched.
    expect(after.evidence).toEqual(before.evidence);
    expect(await database.opportunity.count()).toBe(jobs);
    expect(after.facts).toMatchObject({ compensationBasis: "OTE", salaryText: readNow, salaryMin: 106_400, salaryMax: 197_600, currency: "USD" });
    expect(after.shown.salary).toBe(shownNow);
    // Everything else is as it was.
    expect({ ...after.facts, compensationBasis: null, salaryText: null }).toEqual({ ...before.facts, compensationBasis: null, salaryText: null });
    // Provenance: the corrected facts cite the same version; the earlier
    // reading is kept as superseded history.
    const version = await database.sourceRecord.findFirstOrThrow({ where: { opportunityId } });
    const salaryText = await database.fieldProvenance.findMany({ where: { opportunityId, fieldName: "salaryText" }, orderBy: { createdAt: "asc" } });
    expect(salaryText.map((row) => [row.sourceText, row.sourceRecordId, row.supersededAt !== null])).toEqual([
      [firstSentence, version.id, true],
      [readNow, version.id, false],
    ]);
    // The correction event is recorded on the version (persistence).
    expect(await corrections(opportunityId)).toEqual([expect.objectContaining({ fields: expect.arrayContaining(["compensationBasis", "salaryText"]) })]);
    expect(await evaluationsOf(opportunityId)).toBe(0);

    // Idempotent: the same evidence again corrects nothing and writes no
    // provenance.
    const provenanceRows = await database.fieldProvenance.count({ where: { opportunityId } });
    clock.now = new Date("2026-11-08T12:00:00.000Z");
    const repeat = await captureModeA(id, syntheticPage(id, statement));
    expect(repeat.outcome).toBe("UNCHANGED");
    expect(repeat.normalizationCorrected).toBeUndefined();
    expect(await snapshot(opportunityId)).toEqual(after);
    expect(await database.fieldProvenance.count({ where: { opportunityId } })).toBe(provenanceRows);
    expect(await corrections(opportunityId)).toHaveLength(1);
  });

  it("an eligible Mode B refresh applies the same correction, with no evaluation request; a repeat batch reads nothing", async () => {
    const viaSingle = await (async () => {
      const opportunityId = await saved();
      await captureModeA(id, syntheticPage(id, statement));
      return snapshot(opportunityId);
    })();
    const opportunityId = await saved();
    await readByEarlierReader(opportunityId);
    pages.set(jobUrl(id), syntheticPage(id, statement));
    clock.now = new Date("2026-11-08T11:00:00.000Z");
    const { staged, pass } = await captureModeB([id]);
    expect(staged.counts).toMatchObject({ refreshing: 1, queued: 0 });
    expect(pass).toMatchObject({ ingested: 1 });
    const after = await snapshot(opportunityId);
    // The same corrected facts, provenance and evidence as Single Capture.
    expect({ facts: after.facts, shown: after.shown, provenance: after.provenance, evidence: after.evidence.length }).toEqual({
      facts: viaSingle.facts,
      shown: viaSingle.shown,
      provenance: viaSingle.provenance,
      evidence: 1,
    });
    const item = await database.pageCaptureItem.findFirstOrThrow({ where: { externalId: `linkedin:${id}` } });
    expect(item).toMatchObject({ status: "INGESTED", opportunityId, lastReason: "REFRESHED:CORRECTED:0" });
    expect(handoffs).toEqual([]);
    expect(await evaluationsOf(opportunityId)).toBe(0);
    // The next batch: read by the current reader just now, so not read again.
    navigated.splice(0);
    clock.now = new Date("2026-11-08T12:00:00.000Z");
    const next = await captureModeB([id]);
    expect(next.staged.counts).toMatchObject({ refreshing: 0, alreadySaved: 1 });
    expect(navigated).toEqual([]);
    expect(await snapshot(opportunityId)).toEqual(after);
  });

  it("a user correction is kept; the other facts are corrected", async () => {
    const opportunityId = await saved();
    await database.opportunity.update({ where: { id: opportunityId }, data: { location: "Anywhere in the U.S. (my note)" } });
    await database.fieldProvenance.updateMany({ where: { opportunityId, fieldName: "location", supersededAt: null }, data: { sourceField: "userCorrected:location", sourceText: "Anywhere in the U.S. (my note)" } });
    const again = await captureModeA(id, syntheticPage(id, statement));
    expect(again.normalizationCorrected).toEqual(["Salary"]);
    const after = await snapshot(opportunityId);
    expect(after.facts.location).toBe("Anywhere in the U.S. (my note)");
    expect(after.shown.salary).toBe(shownNow);
  });

  it("another source's evidence takes precedence: a fact it backs is never replaced by re-reading this listing", async () => {
    const opportunityId = await saved();
    const other = await database.sourceRecord.create({
      data: { opportunityId, source: "greenhouse", sourceType: "ATS", externalId: `greenhouse:parity-${randomUUID()}`, sourceUrl: "https://job-boards.greenhouse.io/parity/jobs/1", rawTitle: "Customer Success Manager", discoveredAt: clock.now, lastObservedAt: clock.now },
    });
    await database.fieldProvenance.updateMany({ where: { opportunityId, fieldName: { in: ["salaryText", "salaryMin", "salaryMax", "currency"] }, supersededAt: null }, data: { sourceRecordId: other.id } });
    try {
      const again = await captureModeA(id, syntheticPage(id, statement));
      expect(again.outcome).toBe("UNCHANGED");
      expect(again.normalizationCorrected).toBeUndefined();
      const after = await snapshot(opportunityId);
      expect(after.facts).toMatchObject({ compensationBasis: null, salaryText: firstSentence });
    } finally {
      await database.fieldProvenance.deleteMany({ where: { sourceRecordId: other.id } });
      await database.sourceRecord.delete({ where: { id: other.id } });
    }
  });

  it("a fact the current read does not state is kept, never cleared", async () => {
    const opportunityId = await saved();
    // Saved earlier with relocation support the current reading does not
    // state (the page says nothing about it).
    await database.opportunity.update({ where: { id: opportunityId }, data: { relocationSupport: "AVAILABLE" } });
    const again = await captureModeA(id, syntheticPage(id, statement));
    expect(again.normalizationCorrected).toEqual(["Salary"]);
    const after = await snapshot(opportunityId);
    expect(after.facts.relocationSupport).toBe("AVAILABLE");
  });

  it("changed evidence is still a new version, normalized by the current rules", async () => {
    const opportunityId = await saved();
    clock.now = new Date("2026-11-08T11:00:00.000Z");
    const changed = await captureModeA(id, syntheticPage(id, statement, "<p>Join a team that values ownership.</p>"));
    expect(changed).toMatchObject({ outcome: "CHANGED", opportunityId });
    expect(changed.normalizationCorrected).toBeUndefined();
    const after = await snapshot(opportunityId);
    expect(after.evidence).toHaveLength(2);
    expect(after.facts.compensationBasis).toBe("OTE");
    expect(after.shown.salary).toBe(shownNow);
    expect(await corrections(opportunityId)).toEqual([]);
  });

  it("an evaluation made before the correction is noted on the job page (informational); none is requested", async () => {
    const opportunityId = await saved();
    const version = await database.sourceRecord.findFirstOrThrow({ where: { opportunityId } });
    // Test setup only: a completed evaluation of this version, before the
    // correction.
    await database.evaluation.create({
      data: { opportunityId, sourceRecordId: version.id, domain: "customer-success", status: "COMPLETED", evaluationVersion: "test", domainVersion: "test", ruleVersion: "test", completedAt: new Date("2026-11-08T10:30:00.000Z") },
    });
    try {
      expect(await findListingVersionHint(opportunityId)).toBeNull();
      const again = await captureModeA(id, syntheticPage(id, statement));
      expect(again.normalizationCorrected).toEqual(["Salary"]);
      expect(await findListingVersionHint(opportunityId)).toMatchObject({ correctedFacts: ["Salary"], correctedAt: expect.any(Date) });
      // Still the one evaluation: the correction requested none.
      expect(await evaluationsOf(opportunityId)).toBe(1);
    } finally {
      await database.evaluation.deleteMany({ where: { opportunityId } });
    }
  });

  it("a job whose saved facts already agree is not written at all", async () => {
    await purge([id]);
    const first = await captureModeA(id, syntheticPage(id, statement));
    const rows = await database.fieldProvenance.findMany({ where: { opportunityId: first.opportunityId }, orderBy: { id: "asc" } });
    const job = await database.opportunity.findUniqueOrThrow({ where: { id: first.opportunityId } });
    clock.now = new Date("2026-11-08T11:00:00.000Z");
    const again = await captureModeA(id, syntheticPage(id, statement));
    expect(again.outcome).toBe("UNCHANGED");
    expect(again.normalizationCorrected).toBeUndefined();
    expect(await database.fieldProvenance.findMany({ where: { opportunityId: first.opportunityId }, orderBy: { id: "asc" } })).toEqual(rows);
    const after = await database.opportunity.findUniqueOrThrow({ where: { id: first.opportunityId } });
    // Only the observation times moved.
    expect({ ...after, lastSeenAt: null, updatedAt: null }).toEqual({ ...job, lastSeenAt: null, updatedAt: null });
  });
});

// Welcome to the Jungle: Mode B reads each job in the user's own Chrome
// (background tabs) and sends the reader's capture to the same ingestor the
// worker uses (page-capture-tabs.ts → createPageCaptureIngestor). The real
// November 5 pages (E2), read by the same reader, stored through each path.
describe("Welcome to the Jungle: Single Capture and the background-tab path store the same job", () => {
  const wttj = JSON.parse(readFileSync("tests/fixtures/real-captures/wttj-e2-pages.json", "utf8")) as { pages: Record<string, { url: string; title: string; mainHTML: string }> };
  const ingestor = createPageCaptureIngestor({ repository, ingestion, handoff: { alreadyHandled: async () => false, request: async () => "NO_ACTIVE_PROFILE" }, discovery: customerSuccessDiscoveryConfiguration, now: () => clock.now });
  const wttjIntake = createPageCaptureService({ repository, enabledSites: () => ({ cards: ["welcome-to-the-jungle"], details: ["welcome-to-the-jungle"] }), now: () => clock.now });

  async function purgeWttj(url: string) {
    const records = await database.sourceRecord.findMany({ where: { sourceUrl: { startsWith: url.split("?")[0]! } }, select: { opportunityId: true, externalId: true } });
    const items = await database.pageCaptureItem.findMany({ where: { sourceUrl: url }, select: { opportunityId: true } });
    const opportunityIds = [...new Set([...records, ...items].map((row) => row.opportunityId).filter((id): id is string => Boolean(id)))];
    await database.pageCaptureItem.deleteMany({ where: { sourceUrl: url } });
    await database.$executeRaw`DELETE FROM "PageCaptureSession" s WHERE NOT EXISTS (SELECT 1 FROM "PageCaptureItem" i WHERE i."id" = ANY(s."itemIds"))`;
    const companies = await database.opportunity.findMany({ where: { id: { in: opportunityIds } }, select: { companyId: true } });
    for (;;) {
      const leaves = await database.sourceRecord.findMany({ where: { opportunityId: { in: opportunityIds }, laterObservations: { none: {} } }, select: { id: true } });
      if (!leaves.length) break;
      await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
    }
    await database.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
    for (const { companyId } of companies) if (companyId && !(await database.opportunity.count({ where: { companyId } }))) await database.company.deleteMany({ where: { id: companyId } });
  }

  for (const name of ["servicetitan", "beam", "fourkites"]) {
    it(`${name}: the same facts, provenance, source version and displays`, async () => {
      const page = wttj.pages[name]!;
      const html = `<!doctype html><html><head><title>${page.title}</title></head><body>${page.mainHTML}</body></html>`;
      const read = () => {
        const document = new JSDOM(html, { url: page.url, runScripts: "outside-only" }).window.document;
        const built = buildCaptureEnvelope({ ...readJobPage(document)!, pageUrl: page.url }, "page", { extensionVersion: "0.3.0", capturedAt: clock.now });
        if (!built.ok) throw new Error(built.problems.join("; "));
        return built.envelope;
      };
      await purgeWttj(page.url);
      try {
        const single = await singleJob.capture(read(), pairing);
        const viaSingle = await snapshot(single.result.opportunityId);
        await purgeWttj(page.url);
        const staged = await wttjIntake.capture(
          {
            schemaVersion: 1, kind: "page-capture", batchId: randomUUID(), site: "welcome-to-the-jungle", pageUrl: "https://www.welcometothejungle.com/en/jobs?query=customer%20success",
            pageTitle: "Jobs", capturedAt: clock.now.toISOString(), extensionVersion: "0.3.0", counts: { loaded: 1, skippedUnloaded: 0, overCap: 0 },
            cards: [{ url: page.url, title: page.title, siteJobId: null, company: null, location: null }],
          },
          pairing,
        );
        expect(staged.counts).toMatchObject({ queued: 1 });
        const item = await database.pageCaptureItem.findFirstOrThrow({ where: { sourceUrl: page.url } });
        const batch = await ingestor.ingest(item as never, read() as never);
        const viaTabs = await snapshot(batch.opportunityId);
        expect(viaTabs).toEqual(viaSingle);
      } finally {
        await purgeWttj(page.url);
      }
    });
  }

  // A structured salary range (the page's own structured data) and the job
  // description's wording, through Single Capture and the background-tab
  // path: the same Salary and normalized facts (final pre-live Salary
  // correction, November 8, 2026).
  for (const [slug, description, shown, basis] of [
    ["structured-ote", "The on-target earnings (OTE) for this role are $100,000 - $125,000, split 60/40 between base salary and commission.", "$100,000–$125,000 USD (OTE)", "OTE"],
    ["structured-base-plus", "The base salary range for this role is $100,000 - $125,000. In addition to base salary, this position is eligible for an annual bonus.", "$100,000–$125,000 USD base + bonus", "BASE"],
    ["structured-unlinked", "Top performers regularly exceed an OTE of $180,000.", "$100,000–$125,000 USD", null],
  ] as const) {
    it(`structured salary and job-description wording (${slug}): the same Salary and facts on both paths`, async () => {
      const url = wttj.pages.fourkites!.url.replace(/jobs\/[^/?#]+/, `jobs/parity-${slug}`);
      const envelope = {
        schemaVersion: extensionCaptureSchemaVersion, pageUrl: url, extractor: "structured-data", capturedAt: clock.now.toISOString(), extensionVersion: "0.3.0", readerRevision: 1, notes: [], pageTitle: null, pageText: null,
        fields: {
          title: "Customer Success Manager", company: `Parity Structured ${slug}`, location: "Austin, TX", employmentType: "Full-time",
          description: `Own onboarding, adoption and renewals for a portfolio of mid-market customers.\n\n${description}`,
          salaryMin: 100_000, salaryMax: 125_000, salaryCurrency: "USD", salaryPeriod: "YEAR",
        },
      };
      await purgeWttj(url);
      try {
        const single = await singleJob.capture(envelope, pairing);
        const viaSingle = await snapshot(single.result.opportunityId);
        expect(viaSingle.shown.salary).toBe(shown);
        expect(viaSingle.facts).toMatchObject({ salaryMin: 100_000, salaryMax: 125_000, currency: "USD", compensationBasis: basis });
        await purgeWttj(url);
        const staged = await wttjIntake.capture(
          {
            schemaVersion: 1, kind: "page-capture", batchId: randomUUID(), site: "welcome-to-the-jungle", pageUrl: "https://www.welcometothejungle.com/en/jobs?query=customer%20success",
            pageTitle: "Jobs", capturedAt: clock.now.toISOString(), extensionVersion: "0.3.0", counts: { loaded: 1, skippedUnloaded: 0, overCap: 0 },
            cards: [{ url, title: "Customer Success Manager", siteJobId: null, company: null, location: null }],
          },
          pairing,
        );
        expect(staged.counts).toMatchObject({ queued: 1 });
        const item = await database.pageCaptureItem.findFirstOrThrow({ where: { sourceUrl: url } });
        const viaTabs = await snapshot((await ingestor.ingest(item as never, parseCapture(envelope))).opportunityId);
        expect(viaTabs).toEqual(viaSingle);
      } finally {
        await purgeWttj(url);
      }
    });
  }

  // D1 on the background-tab path, on the real E2 pages with the facts the
  // acceptance database held for these jobs ("stored now", November 6):
  // FourKites' stored facts already agree with today's reading (nothing is
  // written); Beam's arrangement was stored as Unknown (corrected). The
  // background-tab refresh and Single Capture must do the same thing.
  const wttjSaved: Record<string, { stored: StoredFacts; corrected: string[] | undefined }> = {
    fourkites: { stored: { compensationBasis: null, salaryText: null }, corrected: undefined },
    beam: { stored: { remoteStatus: null, workArrangements: [] }, corrected: ["Work arrangement"] },
  };
  for (const [name, saved] of Object.entries(wttjSaved)) {
    it(`D1, ${name} on WTTJ (real saved facts): the background-tab refresh and Single Capture agree, once, with no evaluation request`, async () => {
      const page = wttj.pages[name]!;
      const html = `<!doctype html><html><head><title>${page.title}</title></head><body>${page.mainHTML}</body></html>`;
      const read = () => {
        const document = new JSDOM(html, { url: page.url, runScripts: "outside-only" }).window.document;
        const built = buildCaptureEnvelope({ ...readJobPage(document)!, pageUrl: page.url }, "page", { extensionVersion: "0.3.0", capturedAt: clock.now });
        if (!built.ok) throw new Error(built.problems.join("; "));
        return built.envelope;
      };
      const save = () =>
        wttjIntake.capture(
          {
            schemaVersion: 1, kind: "page-capture", batchId: randomUUID(), site: "welcome-to-the-jungle", pageUrl: "https://www.welcometothejungle.com/en/jobs?query=customer%20success",
            pageTitle: "Jobs", capturedAt: clock.now.toISOString(), extensionVersion: "0.3.0", counts: { loaded: 1, skippedUnloaded: 0, overCap: 0 },
            cards: [{ url: page.url, title: page.title, siteJobId: null, company: null, location: null }],
          },
          pairing,
        );
      await purgeWttj(page.url);
      try {
        const fresh = await snapshot((await singleJob.capture(read(), pairing)).result.opportunityId);
        // Single Capture.
        await purgeWttj(page.url);
        const first = await singleJob.capture(read(), pairing);
        await savedByEarlierNormalizer(first.result.opportunityId, saved.stored);
        const rows = await database.fieldProvenance.count({ where: { opportunityId: first.result.opportunityId } });
        const again = await singleJob.capture(read(), pairing);
        expect(again.result).toMatchObject({ outcome: "UNCHANGED", opportunityId: first.result.opportunityId });
        expect(again.result.normalizationCorrected).toEqual(saved.corrected);
        if (!saved.corrected) expect(await database.fieldProvenance.count({ where: { opportunityId: first.result.opportunityId } })).toBe(rows);
        const viaSingle = await snapshot(first.result.opportunityId);
        expect({ facts: viaSingle.facts, shown: viaSingle.shown }).toEqual({ facts: fresh.facts, shown: fresh.shown });

        // The background-tab path: saved by an earlier reader, refreshed by
        // the next results-page save.
        await purgeWttj(page.url);
        expect((await save()).counts).toMatchObject({ queued: 1 });
        const item = await database.pageCaptureItem.findFirstOrThrow({ where: { sourceUrl: page.url } });
        const stored = await ingestor.ingest(item as never, read() as never);
        await savedByEarlierNormalizer(stored.opportunityId, saved.stored);
        await readByEarlierReader(stored.opportunityId);
        clock.now = new Date("2026-11-08T11:00:00.000Z");
        expect((await save()).counts).toMatchObject({ refreshing: 1 });
        const refreshing = await database.pageCaptureItem.findFirstOrThrow({ where: { sourceUrl: page.url } });
        const refreshed = await ingestor.ingest(refreshing as never, read() as never);
        expect(refreshed).toMatchObject({ outcome: "UNCHANGED", opportunityId: stored.opportunityId });
        // (The ingestion result names provenance fields; the product labels.)
        expect(refreshed.normalizationCorrected && correctedFactLabels(refreshed.normalizationCorrected)).toEqual(saved.corrected);
        const viaTabs = await snapshot(stored.opportunityId);
        expect({ facts: viaTabs.facts, shown: viaTabs.shown, provenance: viaTabs.provenance, versions: viaTabs.evidence.length }).toEqual({
          facts: viaSingle.facts,
          shown: viaSingle.shown,
          provenance: viaSingle.provenance,
          versions: 1,
        });
        expect((await database.pageCaptureItem.findFirstOrThrow({ where: { sourceUrl: page.url } })).lastReason).toBe(saved.corrected ? "REFRESHED:CORRECTED:0" : "REFRESHED:UNCHANGED:0");
        expect(await evaluationsOf(stored.opportunityId)).toBe(0);
      } finally {
        await purgeWttj(page.url);
      }
    });
  }
});

// The November 5–7 LinkedIn jobs on their real stored text (E4: November 5,
// E5: November 7; public descriptions only), each captured through both
// modes: the audited facts, as stored and as shown, in Mode A and Mode B.
describe("the November 5–7 LinkedIn jobs, real text, both modes", () => {
  type Stored = { sourceUrl: string; externalId: string; title: string; company: string; location: string; employmentType: string | null; seniority: string[] | null; description: string };
  const e4 = JSON.parse(readFileSync("tests/fixtures/real-captures/mode-b-e4-linkedin-nov5.json", "utf8")) as { listings: Record<string, Stored> };
  const e5 = JSON.parse(readFileSync("tests/fixtures/real-captures/mode-b-e5-linkedin-nov7.json", "utf8")) as { listings: Record<string, Stored> };
  const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const guestPage = (listing: Stored) =>
    linkedInGuestJobPage({
      id: listing.externalId.split(":")[1]!,
      title: listing.title,
      company: listing.company,
      location: listing.location,
      descriptionHtml: listing.description.split(/\n{2,}/).map((part) => `<p>${part.split("\n").map(escapeHtml).join("<br>")}</p>`).join(""),
      ...(listing.seniority?.[0] ? { seniority: listing.seniority[0] } : {}),
      ...(listing.employmentType ? { employmentType: listing.employmentType } : {}),
    });

  const expected: Record<string, { listing: Stored; shown: Partial<{ salary: string; arrangement: string; residency: string | null }>; facts?: Record<string, unknown> }> = {
    tenex: { listing: e5.listings.tenex!, shown: { salary: "Unknown", arrangement: "Hybrid, with remote availability only by exception", residency: null }, facts: { location: "Sarasota, FL" } },
    nearmap: { listing: e5.listings.nearmap!, shown: { salary: "Unknown", arrangement: "Remote", residency: "Continental U.S. residence required (excluding Alaska and Hawaii)" }, facts: { location: "Lehi, UT" } },
    "thomson-reuters": {
      listing: e5.listings["thomson-reuters"]!,
      shown: { salary: "$106,400–$197,600 USD (Target total cash: base + incentives)", arrangement: "Unknown", residency: null },
      facts: { compensationBasis: "OTE", closingDate: new Date("2026-12-31T00:00:00.000Z") },
    },
    "critical-start": {
      listing: e4.listings["critical-start"]!,
      shown: { salary: "$80,000–$110,000 USD (Base salary)", arrangement: "Unknown", residency: null },
      facts: { closingDate: new Date("2026-11-20T00:00:00.000Z"), location: "Tallahassee, FL" },
    },
    alertmedia: {
      listing: e4.listings.alertmedia!,
      shown: {
        salary: "Unknown",
        arrangement: "Remote",
        residency: "U.S. residence required, excluding: Alaska, California, Hawaii, Louisiana, Mississippi, Montana, New Hampshire, North Dakota, Oregon, Pennsylvania, Rhode Island, Vermont, Washington State, West Virginia, Wyoming",
      },
      facts: { workAuthorizationRequirement: "RIGHT_TO_WORK", visaSponsorship: "NOT_AVAILABLE" },
    },
    "juniper-square": {
      listing: e4.listings["juniper-square"]!,
      shown: { salary: "United States: $86,000–$95,000 USD · Canada: $77,000–$85,000 CAD (Base salary)", arrangement: "Unknown", residency: null },
      facts: { salaryMin: null, salaryMax: null, currency: null, location: "Denver, CO" },
    },
    dataminr: { listing: e4.listings.dataminr!, shown: { salary: "$94,588–$139,412 USD (OTE)", arrangement: "Unknown", residency: null }, facts: { compensationBasis: "OTE" } },
    fourkites: {
      listing: e4.listings.fourkites!,
      shown: { salary: "$100,000–$125,000 USD base + bonus + incentives + equity", arrangement: "Unknown", residency: null },
      facts: { compensationBasis: "BASE", location: "Chicago, IL" },
    },
  };

  for (const [name, job] of Object.entries(expected)) {
    it(`${name}: the audited facts and displays, identical in Mode A and Mode B, with the labelled LinkedIn apply fallback`, async () => {
      const id = job.listing.externalId.split(":")[1]!;
      const { viaSingle, viaBatch } = await bothModes(id, guestPage(job.listing));
      expect(viaBatch).toEqual(viaSingle);
      expect(viaSingle.shown).toMatchObject(job.shown);
      expect(viaSingle.facts).toMatchObject({ ...job.facts, applicationUrl: jobUrl(id), title: job.listing.title });
      expect(viaSingle.company).toBe(job.listing.company);
    });
  }

  // D1 on the real saved evidence: each job as the acceptance database held
  // it (the stored facts the November 6–7 source-version checks reported,
  // "stored now"), captured again with the same evidence.
  const savedNov5to7: Record<string, { stored: StoredFacts; statedText?: Record<string, string>; corrected: string[] }> = {
    tenex: { stored: { remoteStatus: null, workArrangements: [] }, corrected: ["Work arrangement"] },
    nearmap: {
      stored: { remoteStatus: null, workArrangements: [], residencyRequirement: null, residencyRegions: [], residencyExclusions: [], timeZoneRequirements: null },
      corrected: ["Work arrangement", "Residency"],
    },
    "thomson-reuters": {
      stored: {
        compensationBasis: null,
        salaryText: "For any eligible US locations, unless otherwise noted, the target total cash compensation range for this role is $106,400 USD - $197,600 USD.",
      },
      statedText: { salaryText: "For any eligible US locations, unless otherwise noted, the target total cash compensation range for this role is $106,400 USD - $197,600 USD." },
      corrected: ["Salary"],
    },
    "critical-start": { stored: { closingDate: null, applicationUrl: null }, corrected: ["Closing date", "Application link"] },
    alertmedia: {
      stored: { remoteStatus: null, workArrangements: [], residencyRequirement: null, residencyRegions: [], residencyExclusions: [], applicationUrl: null },
      corrected: ["Work arrangement", "Residency", "Application link"],
    },
    "juniper-square": { stored: { compensationTiers: [], currency: null, applicationUrl: null }, corrected: ["Salary", "Application link"] },
    dataminr: { stored: { applicationUrl: null }, corrected: ["Application link"] },
    // Stored with the base salary sentence alone; today's statement adds the
    // employer's "In addition to base salary, … eligible for bonus and
    // incentive compensation … stock option program" sentence.
    fourkites: {
      stored: { applicationUrl: null, salaryText: "The expected annual base salary range for this role is $100,000 - $125,000." },
      statedText: { salaryText: "The expected annual base salary range for this role is $100,000 - $125,000." },
      corrected: ["Salary", "Application link"],
    },
  };
  for (const [name, saved] of Object.entries(savedNov5to7)) {
    it(`D1, ${name} (real saved facts): Single Capture and a Mode B refresh correct it identically, on the same version, once`, async () => {
      const job = expected[name]!;
      const id = job.listing.externalId.split(":")[1]!;
      const html = guestPage(job.listing);
      pages.set(jobUrl(id), html);
      // Today's reading of the evidence, for reference.
      await purge([id]);
      const fresh = await snapshot((await captureModeA(id, html)).opportunityId);

      // Mode A: as saved, then captured again.
      await purge([id]);
      const viaSingle = await (async () => {
        const first = await captureModeA(id, html);
        await savedByEarlierNormalizer(first.opportunityId, saved.stored, saved.statedText);
        const again = await captureModeA(id, html);
        expect(again).toMatchObject({ outcome: "UNCHANGED", opportunityId: first.opportunityId });
        expect(again.normalizationCorrected).toEqual(saved.corrected);
        const repeat = await captureModeA(id, html);
        expect(repeat.normalizationCorrected).toBeUndefined();
        expect(await corrections(first.opportunityId)).toHaveLength(1);
        return snapshot(first.opportunityId);
      })();
      expect(viaSingle.evidence).toHaveLength(1);
      expect({ facts: viaSingle.facts, shown: viaSingle.shown }).toEqual({ facts: fresh.facts, shown: fresh.shown });
      expect(viaSingle.shown).toMatchObject(job.shown);

      // Mode B: as saved by an earlier reader, refreshed by a results-page
      // save and the worker's automatic pass.
      await purge([id]);
      const first = await captureModeA(id, html);
      await savedByEarlierNormalizer(first.opportunityId, saved.stored, saved.statedText);
      await readByEarlierReader(first.opportunityId);
      const { staged, pass } = await captureModeB([id]);
      expect(staged.counts).toMatchObject({ refreshing: 1 });
      expect(pass).toMatchObject({ ingested: 1 });
      const viaBatch = await snapshot(first.opportunityId);
      expect({ facts: viaBatch.facts, shown: viaBatch.shown, provenance: viaBatch.provenance, versions: viaBatch.evidence.length }).toEqual({
        facts: viaSingle.facts,
        shown: viaSingle.shown,
        provenance: viaSingle.provenance,
        versions: 1,
      });
      expect((await database.pageCaptureItem.findFirstOrThrow({ where: { externalId: `linkedin:${id}` } })).lastReason).toBe("REFRESHED:CORRECTED:0");
      expect(handoffs).toEqual([]);
      expect(await evaluationsOf(first.opportunityId)).toBe(0);
    });
  }

  it("FourKites on LinkedIn and on Welcome to the Jungle (real listings): two jobs, a possible duplicate at most, never merged", async () => {
    const linkedin = e4.listings.fourkites!;
    const wttj = e4.listings["fourkites-wttj"]!;
    const id = linkedin.externalId.split(":")[1]!;
    await purge([id]);
    const wttjUrl = wttj.sourceUrl;
    const purgeWttj = async () => {
      const records = await database.sourceRecord.findMany({ where: { sourceUrl: wttjUrl }, select: { opportunityId: true } });
      const ids = records.map((row) => row.opportunityId).filter((value): value is string => Boolean(value));
      await database.sourceRecord.deleteMany({ where: { sourceUrl: wttjUrl } });
      await database.opportunity.deleteMany({ where: { id: { in: ids } } });
    };
    await purgeWttj();
    try {
      const first = await captureModeA(id, guestPage(linkedin));
      const second = await singleJob.capture(
        {
          schemaVersion: extensionCaptureSchemaVersion, pageUrl: wttjUrl, extractor: "structured-data", capturedAt: clock.now.toISOString(), extensionVersion: "0.3.0", readerRevision: 1, notes: [], pageTitle: null, pageText: null,
          fields: { title: wttj.title, company: wttj.company, location: wttj.location, description: wttj.description, employmentType: wttj.employmentType },
        },
        pairing,
      );
      expect(second.result.outcome).toBe("CREATED");
      expect(second.result.opportunityId).not.toBe(first.opportunityId);
      expect((await snapshot(first.opportunityId)).evidence).toHaveLength(1);
    } finally {
      await purgeWttj();
    }
  });
});
