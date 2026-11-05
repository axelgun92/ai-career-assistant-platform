// Mode B E2E helper (bundled by the spec with esbuild, run with node) against the isolated test database only
// (the Playwright config sets DATABASE_URL from TEST_DATABASE_URL and refuses
// any other target). It runs the real automatic detail acquisition pass, the
// one the retrieval worker runs, with a fixture browser that answers the
// synthetic jobs.e2e.invalid job pages (no request leaves the process), the
// real ingestion and the real triage-gated evaluation request. No evaluator
// worker runs, so nothing is evaluated and no provider is called.
//
//   acquire <run> [no-browser]   one or more passes until nothing is due
//   items <run>                  the staged jobs of this run, as JSON
//   cleanup-items <run>          delete the staged jobs of this run
import "dotenv/config";
import { createRetrievalIngestionService } from "../../packages/core/src/index";
import { customerSuccessDiscoveryConfiguration } from "../../domains/customer-success/src/index";
import { PrismaManualOpportunityRepository, PrismaPageCaptureRepository, getDatabaseClient } from "../../database/src/index";
import type { BrowserDriver } from "../../packages/discovery/src/index";
import { createRetrievedOpportunityNormalizer } from "../../packages/normalization/src/index";
import { getEvaluationService } from "../../apps/web/src/server/evaluation-service";
import { createPageCaptureAcquisition, evaluationHandoff } from "../../apps/web/src/server/page-capture-acquisition";
import { assertIsolatedTestDatabase } from "./test-database-guard";
import { e2ePageFor } from "./page-capture-e2e";

assertIsolatedTestDatabase(process.env.DATABASE_URL, "the Mode B E2E helper");

const database = getDatabaseClient();
const [command, run = ""] = process.argv.slice(2);
if (!/^[a-z0-9]{6,20}$/.test(run)) throw new Error("A run token is required");
const ofRun = { externalId: { contains: run } };

try {
  if (command === "acquire") {
    const navigated: string[] = [];
    const driver: BrowserDriver = {
      async navigate(url) {
        navigated.push(url);
        const html = e2ePageFor(run, url);
        return { status: html ? 200 : 404, finalUrl: url, html: html ?? "Not found", cookieNames: [] };
      },
      close: async () => undefined,
    };
    const acquisition = createPageCaptureAcquisition({
      repository: new PrismaPageCaptureRepository(),
      ingestion: createRetrievalIngestionService({ repository: new PrismaManualOpportunityRepository(), normalizer: createRetrievedOpportunityNormalizer() }),
      handoff: evaluationHandoff(getEvaluationService()),
      discovery: customerSuccessDiscoveryConfiguration,
      detailSites: () => ["e2e-results"],
      ...(process.argv[4] === "no-browser" ? {} : { browser: { launch: async () => driver } }),
      sleep: async () => undefined,
    });
    const passes = [];
    for (let pass = 0; pass < 5; pass += 1) {
      const result = await acquisition.runOnce();
      if (!result) break;
      passes.push(result);
    }
    process.stdout.write(JSON.stringify({ passes, navigated }));
  } else if (command === "items") {
    const items = await database.pageCaptureItem.findMany({
      where: ofRun,
      select: { id: true, title: true, status: true, lastReason: true, opportunityId: true, handoffOutcome: true, firstSeenAt: true, sightings: true },
      orderBy: { title: "asc" },
    });
    process.stdout.write(JSON.stringify(items));
  } else if (command === "cleanup-items") {
    await database.pageCaptureItem.deleteMany({ where: ofRun });
    // Capture-history sessions left with none of their jobs (November 5, 2026).
    await database.$executeRaw`DELETE FROM "PageCaptureSession" s WHERE NOT EXISTS (SELECT 1 FROM "PageCaptureItem" i WHERE i."id" = ANY(s."itemIds"))`;
  } else {
    throw new Error("Unknown Mode B E2E helper command");
  }
} finally {
  await database.$disconnect();
}
