// The Feature 14B original-JD retest helper on the isolated test database:
// it re-normalizes a stored source version's exact evidence through the
// production normalization path and prints it beside the stored facts,
// without writing anything (whole-database fingerprint unchanged, writes
// refused by PostgreSQL), without the evaluator and without the network.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRetrievalIngestionService } from "@ai-career/core";
import { customerSuccessDiscoveryConfiguration } from "@ai-career/customer-success";
import {
  createReadOnlyDatabaseClient,
  PrismaExtensionLookupRepository,
  PrismaExtensionPairingRepository,
  PrismaManualOpportunityRepository,
  readOnlyTransaction,
  readStoredSourceVersion,
} from "@ai-career/database";
import { createFixtureTransport, createTitleMatcher, defaultAdapterRegistry } from "@ai-career/discovery";
import { createRetrievedOpportunityNormalizer } from "@ai-career/normalization";
import { buildCaptureEnvelope } from "../../apps/extension/src/envelope";
import { createExtensionApiHandlers } from "../../apps/web/src/server/extension-api";
import { createExtensionCaptureService } from "../../apps/web/src/server/extension-capture";
import {
  compareWithStoredFacts,
  formatSourceVersionCheck,
  renormalizeStoredSourceVersion,
  storedRawOpportunity,
} from "../../apps/web/src/server/source-version-check";
import { createCleanup, database } from "../support/budget-integration";
import { runExtractor } from "../support/extension-pages";
import { healthieGreenhouseResponse, healthiePage } from "../support/healthie-fixture";

const run = promisify(execFile);
const cleanup = createCleanup();
const repository = new PrismaManualOpportunityRepository();
const ingestion = createRetrievalIngestionService({ repository, normalizer: createRetrievedOpportunityNormalizer() });
const api = createExtensionApiHandlers({
  pairings: new PrismaExtensionPairingRepository(),
  captures: createExtensionCaptureService({ ingestion, lookup: new PrismaExtensionLookupRepository(), latestEvaluation: async () => null, discovery: customerSuccessDiscoveryConfiguration }),
  evaluation: { request: async () => new Response(null, { status: 500 }), status: async () => new Response(null, { status: 500 }) },
});
const readOnly = createReadOnlyDatabaseClient(process.env.DATABASE_URL!);
const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
const pairingIds: string[] = [];

beforeEach(() => cleanup.before());
afterEach(async () => {
  vi.unstubAllGlobals();
  const opportunityIds = [...new Set(cleanup.opportunityIds)];
  cleanup.opportunityIds.splice(0, cleanup.opportunityIds.length, ...opportunityIds);
  for (;;) {
    const leaves = await database.sourceRecord.findMany({ where: { opportunityId: { in: opportunityIds }, laterObservations: { none: {} } }, select: { id: true } });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  await cleanup.after();
  await database.extensionPairing.deleteMany({ where: { id: { in: pairingIds.splice(0) } } });
});
afterAll(async () => {
  await readOnly.$disconnect();
  await database.$disconnect();
});

const appOrigin = "http://127.0.0.1:3000";
async function capturePage(pageUrl: string, html = healthiePage()) {
  const pairing = await api.createPairing(new Request(`${appOrigin}/api/extension/pairings`, {
    method: "POST", body: JSON.stringify({ label: "Source-version check browser" }),
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", origin: appOrigin, host: "127.0.0.1:3000" },
  }));
  const paired = (await pairing.json()) as { credential: string; pairing: { id: string } };
  pairingIds.push(paired.pairing.id);
  const envelope = buildCaptureEnvelope(runExtractor(html, pageUrl), "page", { extensionVersion: "0.1.0", capturedAt: new Date() });
  if (!envelope.ok) throw new Error(envelope.problems.join("; "));
  const response = await api.capture(new Request(`${appOrigin}/api/extension/captures`, {
    method: "POST", body: JSON.stringify(envelope.envelope),
    headers: { authorization: `Bearer ${paired.credential}`, origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "content-type": "application/json" },
  }));
  const body = (await response.json()) as { opportunityId: string; outcome: string };
  cleanup.opportunityIds.push(body.opportunityId);
  return body;
}

async function ingestGreenhouse(board: string) {
  const adapter = defaultAdapterRegistry.get("greenhouse")!;
  const config = adapter.configSchema.parse({ board });
  const response = healthieGreenhouseResponse();
  response.jobs[0]!.absolute_url = `https://job-boards.greenhouse.io/${board}/jobs/4425790009`;
  response.jobs[0]!.company_name = `Healthie ${board}`;
  const result = await adapter.collect({
    transport: createFixtureTransport({ [adapter.verificationUrl(config)]: { status: 200, contentType: "application/json", body: JSON.stringify(response) } }),
    discovery: customerSuccessDiscoveryConfiguration, keepTitle: createTitleMatcher(customerSuccessDiscoveryConfiguration.titleTerms),
    env: {}, now: () => new Date(), maxPages: 1, maxDetailRequests: 0,
  }, config);
  const ingested = await ingestion.ingest(result.listings[0]!);
  cleanup.opportunityIds.push(ingested.opportunityId);
  return ingested;
}

// Every row of every table, hashed: equal before and after means nothing
// in the database changed.
async function fingerprint(): Promise<Record<string, string>> {
  const tables = await database.$queryRaw<Array<{ name: string }>>`
    SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name
  `;
  const result: Record<string, string> = {};
  for (const { name } of tables) {
    const [row] = await database.$queryRawUnsafe<Array<{ hash: string }>>(
      `SELECT count(*)::text || ':' || md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS hash FROM public."${name.replace(/"/g, '""')}" t`,
    );
    result[name] = row!.hash;
  }
  return result;
}

const comparable = (rows: Array<{ fieldName: string; sourceField: string; kind: string; normalizedValue: unknown; sourceText: string | null; collectedAt: Date | null }>) =>
  rows
    .map((row) => ({ fieldName: row.fieldName, sourceField: row.sourceField, kind: row.kind, normalizedValue: row.normalizedValue, sourceText: row.sourceText, collectedAt: row.collectedAt?.toISOString() ?? null }))
    .sort((a, b) => `${a.fieldName}|${a.sourceField}`.localeCompare(`${b.fieldName}|${b.sourceField}`));

describe("source-version check: the production normalization path", () => {
  it("rebuilds an extension capture's exact evidence and reproduces what Feature 14B ingestion stored", async () => {
    const pageUrl = `https://job-boards.greenhouse.io/healthie-check-${randomUUID().slice(0, 8)}/jobs/4425790009`;
    const captured = await capturePage(pageUrl);
    expect(captured.outcome).toBe("CREATED");

    const read = (await readStoredSourceVersion(readOnly, { opportunityId: captured.opportunityId }))!;
    const stored = await database.sourceRecord.findUniqueOrThrow({ where: { id: read.version.id } });
    expect(read.version.opportunityId).toBe(captured.opportunityId);
    expect(read.version.domain).toBe("customer-success");
    // The rebuilt input is the stored version itself (its content hash included).
    const raw = storedRawOpportunity(read.version);
    expect(raw).toMatchObject({ source: stored.source, externalId: stored.externalId, description: stored.rawDescription, sourceMetadata: stored.sourceMetadata });
    expect(raw.retrieval).toMatchObject({ retrievalType: "BROWSER_ASSISTED", contentHash: stored.contentHash });

    const result = await renormalizeStoredSourceVersion(read.version);
    expect(result.normalizerName).toBe("createRetrievedOpportunityNormalizer");
    // Same facts as the stored opportunity, and the same provenance rows
    // ingestion recorded for this version.
    expect(compareWithStoredFacts(read.opportunity, result).filter((row) => row.differs)).toEqual([]);
    expect(comparable(result.provenance)).toEqual(comparable(await database.fieldProvenance.findMany({ where: { sourceRecordId: read.version.id } })));
    expect(result.opportunity).toMatchObject({ compensationBasis: "OTE", salaryMin: 105000, salaryMax: 155000, workAuthorizationRequirement: "RIGHT_TO_WORK", applicationUrl: pageUrl });
  });

  it("does the same for an automated retrieval version", async () => {
    const ingested = await ingestGreenhouse(`healthiecheck${randomUUID().slice(0, 8)}`);
    const read = (await readStoredSourceVersion(readOnly, { sourceRecordId: ingested.sourceRecordId }))!;
    const result = await renormalizeStoredSourceVersion(read.version);
    expect(result.normalizerName).toBe("createRetrievedOpportunityNormalizer");
    expect(compareWithStoredFacts(read.opportunity, result).filter((row) => row.differs)).toEqual([]);
    expect(comparable(result.provenance)).toEqual(comparable(await database.fieldProvenance.findMany({ where: { sourceRecordId: ingested.sourceRecordId } })));
  });

  it("shows where a record stored by older normalization differs, and picks the version a 'Nothing changed' recapture observed", async () => {
    const pageUrl = `https://job-boards.greenhouse.io/healthie-stale-${randomUUID().slice(0, 8)}/jobs/4425790009`;
    const captured = await capturePage(pageUrl);
    // Test setup only: make the stored record look like one normalized
    // before v7 (OTE bounds dropped, no basis).
    await database.opportunity.update({ where: { id: captured.opportunityId }, data: { salaryMin: null, salaryMax: null, compensationBasis: null } });
    expect((await capturePage(pageUrl)).outcome).toBe("UNCHANGED");

    const read = (await readStoredSourceVersion(readOnly, { opportunityId: captured.opportunityId }))!;
    const result = await renormalizeStoredSourceVersion(read.version);
    const differing = compareWithStoredFacts(read.opportunity, result).filter((row) => row.differs);
    expect(differing.map((row) => row.label)).toEqual(["Salary (as shown)", "Salary minimum", "Salary maximum", "Compensation basis"]);
    expect(differing[0]).toMatchObject({ stored: "Unknown", current: "105,000–155,000 (currency unknown) (OTE)" });
    const report = formatSourceVersionCheck({ database: databaseName, read, result });
    expect(report).toContain("* Salary (as shown)");
    expect(report).toContain("4 fact(s) marked * differ");
    expect(report).toContain("Nothing in the database was changed.");
  });
});

describe("source-version check: read-only", () => {
  it("changes nothing in the database, calls no network and creates no evaluation", async () => {
    const captured = await capturePage(`https://job-boards.greenhouse.io/healthie-ro-${randomUUID().slice(0, 8)}/jobs/4425790009`);
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network is not allowed")));
    vi.stubGlobal("fetch", fetchSpy);
    const before = await fingerprint();
    const read = (await readStoredSourceVersion(readOnly, { opportunityId: captured.opportunityId }))!;
    formatSourceVersionCheck({ database: databaseName, read, result: await renormalizeStoredSourceVersion(read.version) });
    expect(await fingerprint()).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await database.evaluation.count({ where: { opportunityId: captured.opportunityId } })).toBe(0);
  });

  it("PostgreSQL refuses writes: inside its READ ONLY transaction and on its read-only client", async () => {
    const captured = await capturePage(`https://job-boards.greenhouse.io/healthie-guard-${randomUUID().slice(0, 8)}/jobs/4425790009`);
    const title = (await database.opportunity.findUniqueOrThrow({ where: { id: captured.opportunityId } })).title;
    // The general application client, wrapped the way every read is.
    await expect(readOnlyTransaction(database, (transaction) => transaction.opportunity.update({ where: { id: captured.opportunityId }, data: { title: "Changed" } })))
      .rejects.toThrow(/read-only transaction/);
    await expect(readOnly.opportunity.update({ where: { id: captured.opportunityId }, data: { title: "Changed" } })).rejects.toThrow(/read-only transaction/);
    await expect(readOnly.$executeRawUnsafe(`DELETE FROM "SourceRecord" WHERE "opportunityId" = '${captured.opportunityId}'`)).rejects.toThrow(/read-only transaction/);
    expect((await database.opportunity.findUniqueOrThrow({ where: { id: captured.opportunityId } })).title).toBe(title);
  });

  it("the command prints the comparison, changes nothing, and refuses a database other than the one named", async () => {
    const captured = await capturePage(`https://job-boards.greenhouse.io/healthie-cli-${randomUUID().slice(0, 8)}/jobs/4425790009`);
    const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL! };
    const before = await fingerprint();
    const { stdout } = await run("pnpm", ["--silent", "acceptance:check-source-version", "--database", databaseName, "--opportunity", `http://localhost:3000/opportunities/${captured.opportunityId}`], { env });
    expect(stdout).toContain("Feature 14B source-version check (read-only: nothing was written)");
    expect(stdout).toContain(`Opportunity:     ${captured.opportunityId}`);
    expect(stdout).toContain("No differences");
    expect(await fingerprint()).toEqual(before);

    const refused = await run("pnpm", ["--silent", "acceptance:check-source-version", "--database", "ai_career_assistant_acceptance", "--opportunity", captured.opportunityId], { env })
      .then(() => null, (error: { code: number; stderr: string }) => error);
    expect(refused?.code).toBe(1);
    expect(refused?.stderr).toContain(`DATABASE_URL points to database "${databaseName}", not "ai_career_assistant_acceptance". Nothing was read.`);
  }, 120_000);
});
