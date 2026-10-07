import { getDatabaseClient } from "./client";
import {
  PrismaUserProfileImportRepository,
  type UserProfileImportResult,
  type VersionedUserProfileData,
} from "./user-profile-import-repository";

// The stored profile document exactly as persisted. Unset sections stay null
// and unset preference fields stay absent; nothing is defaulted here.
export interface UserProfileDocument {
  label: string;
  careerGoals: unknown;
  experience: unknown;
  skills: unknown;
  transferableSkills: unknown;
  locationPreferences: unknown;
  compensationPreferences: unknown;
  workPreferences: unknown;
  companyPreferences: unknown;
  domainPreferences: unknown;
}

export interface UserProfileVersion {
  id: string;
  label: string;
  version: number;
  contentHash: string | null;
  createdAt: Date;
  document: UserProfileDocument;
}

export interface UserProfileVersionSummary {
  id: string;
  label: string;
  version: number;
  createdAt: Date;
  evaluationCount: number;
}

export interface ActiveUserProfileView {
  domain: string;
  userProfileId: string;
  version: number;
  label: string;
  activatedAt: Date;
}

export type SaveUserProfileVersionResult = UserProfileImportResult & {
  activated: boolean;
};

const documentSelect = {
  id: true,
  label: true,
  version: true,
  contentHash: true,
  createdAt: true,
  careerGoals: true,
  experience: true,
  skills: true,
  transferableSkills: true,
  locationPreferences: true,
  compensationPreferences: true,
  workPreferences: true,
  companyPreferences: true,
  domainPreferences: true,
} as const;

// Profile versions and the explicit active-version pointer. Saving always
// appends through the existing import repository; activation only moves the
// ActiveUserProfile pointer and never updates a UserProfile row.
export class PrismaUserProfileRepository {
  private readonly database = getDatabaseClient();
  private readonly importer = new PrismaUserProfileImportRepository();

  async getActive(domain: string): Promise<ActiveUserProfileView | null> {
    const active = await this.database.activeUserProfile.findUnique({
      where: { domain },
      select: {
        domain: true,
        activatedAt: true,
        userProfile: { select: { id: true, version: true, label: true } },
      },
    });
    if (!active) return null;
    return {
      domain: active.domain,
      userProfileId: active.userProfile.id,
      version: active.userProfile.version,
      label: active.userProfile.label,
      activatedAt: active.activatedAt,
    };
  }

  async getVersion(id: string): Promise<UserProfileVersion | null> {
    const row = await this.database.userProfile.findUnique({
      where: { id },
      select: documentSelect,
    });
    if (!row) return null;
    return {
      id: row.id,
      label: row.label,
      version: row.version,
      contentHash: row.contentHash,
      createdAt: row.createdAt,
      document: {
        label: row.label,
        careerGoals: row.careerGoals,
        experience: row.experience,
        skills: row.skills,
        transferableSkills: row.transferableSkills,
        locationPreferences: row.locationPreferences,
        compensationPreferences: row.compensationPreferences,
        workPreferences: row.workPreferences,
        companyPreferences: row.companyPreferences,
        domainPreferences: row.domainPreferences,
      },
    };
  }

  async listVersions(): Promise<UserProfileVersionSummary[]> {
    const rows = await this.database.userProfile.findMany({
      orderBy: [{ createdAt: "desc" }, { version: "desc" }],
      select: {
        id: true,
        label: true,
        version: true,
        createdAt: true,
        _count: { select: { evaluations: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      version: row.version,
      createdAt: row.createdAt,
      evaluationCount: row._count.evaluations,
    }));
  }

  // The profile new evaluations use today when nothing was ever activated:
  // the pre-existing newest-profile fallback, unchanged.
  async findFallbackProfile() {
    return this.database.userProfile.findFirst({
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, version: true },
    });
  }

  // The profile version pinned on an opportunity's latest evaluation (read-only).
  async findLatestEvaluationProfile(opportunityId: string) {
    return this.database.evaluation.findFirst({
      where: { opportunityId },
      orderBy: { createdAt: "desc" },
      select: { userProfileId: true, userProfileVersion: true },
    });
  }

  async setActive(
    domain: string,
    userProfileId: string,
  ): Promise<{ status: "ACTIVATED"; activatedAt: Date } | { status: "NOT_FOUND" }> {
    const exists = await this.database.userProfile.findUnique({
      where: { id: userProfileId },
      select: { id: true },
    });
    if (!exists) return { status: "NOT_FOUND" };
    const activatedAt = new Date();
    await this.database.activeUserProfile.upsert({
      where: { domain },
      create: { domain, userProfileId, activatedAt },
      update: { userProfileId, activatedAt },
    });
    return { status: "ACTIVATED", activatedAt };
  }

  // Guard against implicit takeover: before the first save, pin whatever new
  // evaluations resolve to right now, so a saved version never becomes the
  // evaluation profile unless the user explicitly activates it.
  async pinCurrentIfUnset(domain: string): Promise<void> {
    const existing = await this.database.activeUserProfile.findUnique({
      where: { domain },
      select: { domain: true },
    });
    if (existing) return;
    const current = await this.findFallbackProfile();
    if (!current) return;
    await this.database.activeUserProfile.createMany({
      data: [{ domain, userProfileId: current.id }],
      skipDuplicates: true,
    });
  }

  async saveVersion(
    domain: string,
    data: VersionedUserProfileData,
    options: { activate: boolean },
  ): Promise<SaveUserProfileVersionResult> {
    await this.pinCurrentIfUnset(domain);
    const result = await this.importer.import(data);
    if (!options.activate) return { ...result, activated: false };
    const activation = await this.setActive(domain, result.id);
    return { ...result, activated: activation.status === "ACTIVATED" };
  }
}
