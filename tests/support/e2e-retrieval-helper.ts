import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRetrievalIngestionService } from "../../packages/core/src/index";
import { customerSuccessDiscoveryConfiguration } from "../../domains/customer-success/src/discovery/discovery-config";
import {
  getDatabaseClient,
  PrismaManualOpportunityRepository,
  PrismaRetrievalSourceRepository,
} from "../../database/src/index";
import { createFixtureTransport, defaultAdapterRegistry, fixtureRequestKey, workdayListBody } from "../../packages/discovery/src/index";
import { createRetrievedOpportunityNormalizer } from "../../packages/normalization/src/index";
import { createRetrievalWorker } from "../../apps/web/src/server/retrieval-worker";

// Deterministic E2E helper for Features 11A and 11B. run-retrieval runs one
// retrieval worker iteration with the fixture transport serving the
// committed Greenhouse, Workday, Workable and Wellfound fixtures (never the network);
// "changed" serves Greenhouse with the Customer Success posting's
// description extended. Only the isolated test database is ever used
// (Playwright points DATABASE_URL at it).

const database = getDatabaseClient();
const command = process.argv[2];
const fixture = readFileSync(path.resolve("tests/fixtures/sources/greenhouse/response.json"), "utf8");
const fixtureIds = (JSON.parse(fixture) as { jobs: Array<{ id: number }> }).jobs.map((job) => String(job.id));
const greenhouseUrl = "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true";
const fixtureFile = (adapter: string, file: string) => readFileSync(path.resolve(`tests/fixtures/sources/${adapter}/${file}`), "utf8");
const workdayPath = "/job/USA-IL-Chicago/Revenue-Operations-Director--Global-Customer-Success_JR-0110682";
const workdaySite = "https://workday.wd5.myworkdayjobs.com/wday/cxs/workday/Workday";
const json = (body: string) => ({ status: 200, contentType: "application/json", body });
// The Wellfound fixture limited to one page, so a run completes.
const wellfoundPage = fixtureFile("wellfound", "response.html").replace(/"pageCount":\s*11/, '"pageCount": 1');
const fixtureListings = [
  { source: "greenhouse", externalId: { in: fixtureIds } },
  { source: "workday", externalId: { endsWith: workdayPath } },
  { source: "wellfound", externalId: { in: ["1716423", "4829861", "3886599"] } },
  { source: "workable", externalId: { in: ["1671f9c9-4f39-44b7-b44a-5889b15bfafd", "0686d816-4047-43c8-8fc9-e73eb6aa2bf2", "87fe7050-1014-4a7f-abdf-d982fed59223"] } },
];
const fixtureCompanies = ["Workday, Inc.", "Pragma (formerly Logisy)", "Medsender", "Trackier", "ClickView", "DMED"];
// The Workable fixture limited to one page.
const workablePage = JSON.stringify({ ...JSON.parse(fixtureFile("workable", "response.json")), nextPageToken: null });

function body(variant: string | undefined) {
  if (variant !== "changed") return fixture;
  const value = JSON.parse(fixture) as { jobs: Array<{ content: string }> };
  value.jobs[0]!.content += "&lt;p&gt;Added after first retrieval: lead quarterly business reviews.&lt;/p&gt;";
  return JSON.stringify(value);
}

// Removes what earlier runs stored from the fixture's listings: later
// observations first, then their opportunities if nothing else is linked.
async function resetFixtureListings() {
  const records = await database.sourceRecord.findMany({
    where: { OR: fixtureListings },
    select: { opportunityId: true },
  });
  const opportunityIds = [...new Set(records.map((record) => record.opportunityId).filter((id): id is string => id !== null))];
  for (;;) {
    const leaves = await database.sourceRecord.findMany({
      where: { OR: [...fixtureListings, { opportunityId: { in: opportunityIds } }], laterObservations: { none: {} } },
      select: { id: true },
    });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  await database.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
  await database.company.deleteMany({ where: { name: { in: fixtureCompanies }, opportunities: { none: {} } } });
}

try {
  if (command === "reset-fixture-listings") {
    await resetFixtureListings();
  } else if (command === "run-retrieval") {
    const store = new PrismaRetrievalSourceRepository();
    const worker = createRetrievalWorker({
      store,
      ingestion: createRetrievalIngestionService({
        repository: new PrismaManualOpportunityRepository(),
        normalizer: createRetrievedOpportunityNormalizer(),
      }),
      registry: defaultAdapterRegistry,
      transport: () =>
        createFixtureTransport({
          [greenhouseUrl]: json(body(process.argv[3])),
          [fixtureRequestKey(`${workdaySite}/jobs`, workdayListBody(0))]: json(fixtureFile("workday", "response.json")),
          [`${workdaySite}${workdayPath}`]: json(fixtureFile("workday", "detail-JR-0110682.json")),
          "https://wellfound.com/role/customer-success-specialist": { status: 200, contentType: "text/html; charset=utf-8", body: wellfoundPage },
          "https://jobs.workable.com/api/v1/jobs?query=customer%20success": json(workablePage),
        }),
      discovery: customerSuccessDiscoveryConfiguration,
      env: () => ({}),
      now: () => new Date(),
      log: { info: () => undefined, warn: () => undefined },
      lastChecked: (source, externalIds) => store.lastCheckedListings(source, externalIds),
    });
    process.stdout.write(JSON.stringify(await worker.runOnce()));
  } else if (command === "cleanup-source") {
    const sourceId = process.argv[3]!;
    await resetFixtureListings();
    await database.sourceRecord.deleteMany({ where: { retrievalSourceId: sourceId } });
    await database.retrievalRun.deleteMany({ where: { retrievalSourceId: sourceId } });
    await database.retrievalSource.deleteMany({ where: { id: sourceId } });
  } else {
    throw new Error("Unknown retrieval E2E helper command");
  }
} finally {
  await database.$disconnect();
}
