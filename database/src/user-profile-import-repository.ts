import { createHash } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import { getDatabaseClient } from "./client";

export interface VersionedUserProfileData {
  label: string;
  careerGoals: Prisma.InputJsonValue;
  experience: Prisma.InputJsonValue;
  skills: Prisma.InputJsonValue;
  transferableSkills: Prisma.InputJsonValue;
  locationPreferences: Prisma.InputJsonValue;
  compensationPreferences: Prisma.InputJsonValue;
  workPreferences: Prisma.InputJsonValue;
  companyPreferences: Prisma.InputJsonValue;
  domainPreferences: Prisma.InputJsonValue;
}

export type UserProfileImportResult =
  | {
      status: "CREATED";
      id: string;
      version: number;
      contentHash: string;
    }
  | {
      status: "ALREADY_IMPORTED";
      id: string;
      version: number;
      contentHash: string;
    };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function hashUserProfileData(data: VersionedUserProfileData): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(data)))
    .digest("hex");
}

export class PrismaUserProfileImportRepository {
  private readonly database = getDatabaseClient();

  async import(data: VersionedUserProfileData): Promise<UserProfileImportResult> {
    const contentHash = hashUserProfileData(data);
    return this.database.$transaction(
      async (transaction) => {
        const existing = await transaction.userProfile.findUnique({
          where: {
            label_contentHash: { label: data.label, contentHash },
          },
          select: { id: true, version: true },
        });
        if (existing) {
          return { status: "ALREADY_IMPORTED", ...existing, contentHash };
        }

        const latest = await transaction.userProfile.findFirst({
          where: { label: data.label },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const version = (latest?.version ?? 0) + 1;
        const created = await transaction.userProfile.create({
          data: { ...data, version, contentHash },
          select: { id: true, version: true },
        });
        return { status: "CREATED", ...created, contentHash };
      },
      { isolationLevel: "Serializable" },
    );
  }
}
