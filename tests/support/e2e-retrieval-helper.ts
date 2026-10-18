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
import { createFixtureTransport, defaultAdapterRegistry } from "../../packages/discovery/src/index";
import { createRetrievedOpportunityNormalizer } from "../../packages/normalization/src/index";
import { createRetrievalWorker } from "../../apps/web/src/server/retrieval-worker";

// Deterministic E2E helper for Feature 11A. run-retrieval runs one retrieval
// worker iteration with the fixture transport serving the committed
// Greenhouse fixture (never the network); "changed" serves it with the
// Customer Success posting's description extended. Only the isolated test
// database is ever used (Playwright points DATABASE_URL at it).

const database = getDatabaseClient();
const command = process.argv[2];
const fixture = readFileSync(path.resolve("tests/fixtures/sources/greenhouse/response.json"), "utf8");
const fixtureIds = (JSON.parse(fixture) as { jobs: Array<{ id: number }> }).jobs.map((job) => String(job.id));
const greenhouseUrl = "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true";

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
    where: { source: "greenhouse", externalId: { in: fixtureIds } },
    select: { opportunityId: true },
  });
  const opportunityIds = [...new Set(records.map((record) => record.opportunityId).filter((id): id is string => id !== null))];
  for (;;) {
    const leaves = await database.sourceRecord.findMany({
      where: { OR: [{ source: "greenhouse", externalId: { in: fixtureIds } }, { opportunityId: { in: opportunityIds } }], laterObservations: { none: {} } },
      select: { id: true },
    });
    if (!leaves.length) break;
    await database.sourceRecord.deleteMany({ where: { id: { in: leaves.map((leaf) => leaf.id) } } });
  }
  await database.opportunity.deleteMany({ where: { id: { in: opportunityIds } } });
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
      transport: () => createFixtureTransport({ [greenhouseUrl]: { status: 200, contentType: "application/json", body: body(process.argv[3]) } }),
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
