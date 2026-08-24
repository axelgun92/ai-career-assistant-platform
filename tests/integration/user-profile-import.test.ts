import { validateCustomerSuccessUserProfileData } from "@ai-career/customer-success";
import {
  getDatabaseClient,
  PrismaEvaluationQueryRepository,
  PrismaUserProfileImportRepository,
  type VersionedUserProfileData,
} from "@ai-career/database";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { alexandraNugentCustomerSuccessProfile } from "../../apps/web/src/server/profile-import/alexandra-nugent-customer-success-profile";

const database = getDatabaseClient();
const labels: string[] = [];

afterAll(async () => {
  await database.userProfile.deleteMany({ where: { label: { in: labels } } });
  await database.$disconnect();
});

describe("versioned local user-profile import", () => {
  it("creates v1, avoids duplicate content, appends v2, and resolves the latest profile", async () => {
    const label = `Profile import test ${randomUUID()}`;
    labels.push(label);
    const repository = new PrismaUserProfileImportRepository();
    const base = validateCustomerSuccessUserProfileData({
      ...alexandraNugentCustomerSuccessProfile,
      label,
    }) as VersionedUserProfileData;

    const first = await repository.import(base);
    const duplicate = await repository.import(base);
    const changed = validateCustomerSuccessUserProfileData({
      ...base,
      careerGoals: [
        ...(base.careerGoals as Array<{ id: string; statement: string }>),
        { id: "future-version", statement: "A future verified profile update." },
      ],
    }) as VersionedUserProfileData;
    const second = await repository.import(changed);

    expect(first.status).toBe("CREATED");
    expect(first.version).toBe(1);
    expect(duplicate.status).toBe("ALREADY_IMPORTED");
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.version).toBe(1);
    expect(second.status).toBe("CREATED");
    expect(second.version).toBe(2);
    expect(second.id).not.toBe(first.id);

    const versions = await database.userProfile.findMany({
      where: { label },
      orderBy: { version: "asc" },
      select: { id: true, version: true },
    });
    expect(versions).toEqual([
      { id: first.id, version: 1 },
      { id: second.id, version: 2 },
    ]);

    const resolved = await new PrismaEvaluationQueryRepository().resolveUserProfile(
      null,
    );
    expect(resolved).toEqual({ id: second.id, version: 2 });
  });
});
