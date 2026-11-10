import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createManualOpportunityService } from "@ai-career/core";
import {
  getDatabaseClient,
  PrismaManualOpportunityRepository,
  PrismaOpportunityListRepository,
} from "@ai-career/database";
import { createManualOpportunityNormalizer } from "@ai-career/normalization";

const database = getDatabaseClient();
const createdOpportunityIds: string[] = [];

afterEach(async () => {
  for (const id of createdOpportunityIds.splice(0)) {
    const opportunity = await database.opportunity.findUnique({
      where: { id },
      select: { companyId: true },
    });
    await database.sourceRecord.deleteMany({ where: { opportunityId: id } });
    // Evaluations, tasks, and recommendations cascade with the opportunity.
    await database.opportunity.deleteMany({ where: { id } });
    if (opportunity?.companyId) {
      await database.company.deleteMany({ where: { id: opportunity.companyId } });
    }
  }
});

afterAll(async () => {
  await database.$disconnect();
});

async function createOpportunity(title: string | undefined, createdAt: Date) {
  const service = createManualOpportunityService({
    repository: new PrismaManualOpportunityRepository(),
    normalizer: createManualOpportunityNormalizer(),
  });
  const detail = await service.submit({
    rawText: `Integration JD for ${title ?? "an untitled role"}`,
    title,
    company: title ? `${title} Company` : undefined,
    domain: "customer-success",
  });
  createdOpportunityIds.push(detail.opportunity.id);
  await database.opportunity.update({
    where: { id: detail.opportunity.id },
    data: { createdAt },
  });
  return detail.opportunity.id;
}

async function createEvaluation(input: {
  opportunityId: string;
  createdAt: Date;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  taskStatus?: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  decision?: string;
}) {
  const evaluation = await database.evaluation.create({
    data: {
      opportunityId: input.opportunityId,
      domain: "customer-success",
      status: input.status,
      evaluationVersion: "list-test",
      domainVersion: "list-test",
      ruleVersion: "list-test",
      createdAt: input.createdAt,
      completedAt: input.status === "COMPLETED" ? input.createdAt : null,
    },
  });
  if (input.taskStatus) {
    await database.evaluationTask.create({
      data: { evaluationId: evaluation.id, status: input.taskStatus, maxAttempts: 1 },
    });
  }
  if (input.decision) {
    await database.recommendation.create({
      data: {
        opportunityId: input.opportunityId,
        evaluationId: evaluation.id,
        decision: input.decision,
        evidenceReferences: [],
        explanation: "Persisted test recommendation.",
        evaluationVersion: "list-test",
      },
    });
  }
  return evaluation.id;
}

function ownItems<T extends { id: string }>(items: T[]) {
  return items.filter((item) => createdOpportunityIds.includes(item.id));
}

describe("opportunity list PostgreSQL query", () => {
  it("lists opportunities newest first with their latest persisted evaluation", async () => {
    const older = await createOpportunity("Older Role", new Date("2026-09-01T10:00:00.000Z"));
    const newer = await createOpportunity("Newer Role", new Date("2026-09-02T10:00:00.000Z"));
    const unevaluated = await createOpportunity(undefined, new Date("2026-09-03T10:00:00.000Z"));

    await createEvaluation({
      opportunityId: older,
      createdAt: new Date("2026-09-01T11:00:00.000Z"),
      status: "COMPLETED",
      taskStatus: "COMPLETED",
      decision: "APPLY",
    });
    const latestForOlder = await createEvaluation({
      opportunityId: older,
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
      status: "PENDING",
      taskStatus: "RUNNING",
    });
    const onlyForNewer = await createEvaluation({
      opportunityId: newer,
      createdAt: new Date("2026-09-02T11:00:00.000Z"),
      status: "COMPLETED",
      taskStatus: "COMPLETED",
      decision: "REVIEW",
    });

    const items = ownItems(await new PrismaOpportunityListRepository().listOpportunities());

    expect(items.map((item) => item.id)).toEqual([unevaluated, newer, older]);

    const [unevaluatedItem, newerItem, olderItem] = items;
    expect(unevaluatedItem).toMatchObject({
      title: null,
      companyName: null,
      domain: "customer-success",
      status: "NORMALIZED",
      latestEvaluation: null,
    });
    expect(newerItem).toMatchObject({
      title: "Newer Role",
      companyName: "Newer Role Company",
      latestEvaluation: { id: onlyForNewer, status: "COMPLETED", decision: "REVIEW" },
    });
    // The newest evaluation wins even when an older one has a decision; the
    // user-visible status is the task status, matching the evaluation API.
    expect(olderItem?.latestEvaluation).toMatchObject({
      id: latestForOlder,
      status: "RUNNING",
      decision: null,
      completedAt: null,
    });
  });

  it("bounds the number of returned opportunities", async () => {
    await createOpportunity("First", new Date("2026-09-04T10:00:00.000Z"));
    await createOpportunity("Second", new Date("2026-09-05T10:00:00.000Z"));

    const repository = new PrismaOpportunityListRepository();
    expect(await repository.listOpportunities({ limit: 1 })).toHaveLength(1);
    expect((await repository.listOpportunities({ limit: 0 })).length).toBeGreaterThanOrEqual(1);
  });
});
