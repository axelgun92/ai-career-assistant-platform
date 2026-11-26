import "dotenv/config";
import { getDatabaseClient } from "../../database/src/index";
import { normalizeCompanyName } from "../../packages/deduplication/src/index";

// Deterministic E2E helper for Feature 18 (Company Intelligence).
// "seed <token>" writes one synthetic company directly (no provider, no
// network): two Company rows sharing a normalized name, a configured board,
// a currently listed role you applied to and were screened for, a role listed
// again after a confirmed removal, and a manual capture you applied to that
// closed with no response. "cleanup <token>" removes everything the seed
// wrote. Only the isolated test database is ever used.

const database = getDatabaseClient();
const [command, token] = process.argv.slice(2);
const dayMs = 24 * 60 * 60 * 1000;
const now = Date.now();
const ago = (days: number) => new Date(now - days * dayMs);
const dateAgo = (days: number) => new Date(`${ago(days).toISOString().slice(0, 10)}T00:00:00.000Z`);
const companyName = (tag: string) => `Zenith Robotics ${tag}`;

async function seed(tag: string) {
  const scope = `e2e-company-${tag}`;
  const board = await database.retrievalSource.create({
    data: { adapterKey: "greenhouse", name: `Zenith board ${tag}`, domain: "customer-success", retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS", enabled: false, config: {}, trackingScopeKey: scope },
  });
  const company = async (name: string) => (await database.company.create({ data: { name, normalizedName: normalizeCompanyName(name) } })).id;
  const primary = await company(companyName(tag));
  const legacy = await company(`ZENITH ROBOTICS ${tag}, Inc.`);
  const role = async (title: string, companyId: string, arrangement: "REMOTE" | "HYBRID", origin: "board" | "manual", externalId: string) => {
    const opportunity = await database.opportunity.create({
      data: { title: `${title} ${tag}`, domain: "customer-success", status: "APPLIED", companyId, remoteStatus: arrangement, workArrangements: [arrangement], residencyRegions: ["US"], firstSeenAt: ago(45), lastSeenAt: ago(0.05) },
    });
    await database.sourceRecord.create({
      data:
        origin === "board"
          ? { opportunityId: opportunity.id, source: "greenhouse", sourceType: "ATS", externalId: `${tag}-${externalId}`, retrievalSourceId: board.id, retrievalType: "OFFICIAL_PUBLIC_API_FEED", sourceCategory: "ATS", contentHash: `${tag}-${externalId}`, createdAt: ago(45), discoveredAt: ago(45), sourceMetadata: { e2eCompany: tag } }
          : { opportunityId: opportunity.id, source: "manual-input", sourceType: "MANUAL", createdAt: ago(45), discoveredAt: ago(45), sourceMetadata: { e2eCompany: tag } },
    });
    if (origin === "board") {
      await database.retrievedListing.create({
        data: {
          retrievalSourceId: board.id, trackingScopeKey: scope, source: "greenhouse", externalId: `${tag}-${externalId}`, opportunityId: opportunity.id, removalCapable: true, state: "LISTED", firstSeenAt: ago(45), lastSeenAt: ago(0.05),
          ...(externalId === "relisted" ? { removedAt: ago(10), reappearedAt: ago(3), reappearances: 1 } : {}),
        },
      });
    }
    return opportunity.id;
  };
  const screened = await role("Customer Success Manager", primary, "REMOTE", "board", "listed");
  await role("Customer Success Manager", legacy, "REMOTE", "board", "relisted");
  const manual = await role("Implementation Consultant", primary, "HYBRID", "manual", "manual");

  const application = await database.application.create({ data: { opportunityId: screened, stage: "SCREENING", appliedOn: dateAgo(40) } });
  await database.applicationEvent.create({ data: { applicationId: application.id, sequence: 1, type: "SUBMITTED", occurredOn: dateAgo(40) } });
  await database.applicationEvent.create({ data: { applicationId: application.id, sequence: 2, type: "STAGE_CHANGED", toStage: "SCREENING", createdAt: ago(34) } });
  await database.applicationInterview.create({ data: { applicationId: application.id, kind: "RECRUITER_SCREEN", status: "COMPLETED", scheduledAt: ago(31), createdAt: ago(34) } });
  const closed = await database.application.create({ data: { opportunityId: manual, stage: "CLOSED", outcome: "NO_RESPONSE", appliedOn: dateAgo(60), closedOn: dateAgo(30) } });
  await database.applicationEvent.create({ data: { applicationId: closed.id, sequence: 1, type: "SUBMITTED", occurredOn: dateAgo(60) } });
  await database.applicationEvent.create({ data: { applicationId: closed.id, sequence: 2, type: "CLOSED", toStage: "CLOSED", outcome: "NO_RESPONSE", occurredOn: dateAgo(30) } });
  console.log(JSON.stringify({ companyId: primary, legacyId: legacy, screenedId: screened }));
}

async function cleanup(tag: string) {
  await database.sourceRecord.deleteMany({ where: { sourceMetadata: { path: ["e2eCompany"], equals: tag } } });
  await database.opportunity.deleteMany({ where: { title: { endsWith: ` ${tag}` }, company: { name: { contains: tag } } } });
  await database.retrievalSource.deleteMany({ where: { name: `Zenith board ${tag}` } });
  await database.company.deleteMany({ where: { name: { contains: tag } } });
}

if (!token) throw new Error("usage: e2e-company-helper <seed|cleanup> <token>");
if (command === "seed") await seed(token);
else if (command === "cleanup") await cleanup(token);
else throw new Error(`unknown command ${command}`);
await database.$disconnect();
