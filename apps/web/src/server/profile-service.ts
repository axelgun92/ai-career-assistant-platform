import {
  customerSuccessDomainPreferencesSchema,
  customerSuccessPreferencesSchema,
  customerSuccessUserProfileDataSchema,
  validateCustomerSuccessUserProfileData,
} from "@ai-career/customer-success";
import {
  PrismaUserProfileRepository,
  type ActiveUserProfileView,
  type SaveUserProfileVersionResult,
  type UserProfileVersion,
  type UserProfileVersionSummary,
  type VersionedUserProfileData,
} from "@ai-career/database";
import { z, type ZodType } from "zod";
import {
  applyStructuredChanges,
  isPlainObject,
  readPath,
  StructuredChangeError,
  structuredFields,
  type ProfileDocument,
} from "../components/profile/structured-fields";

export const profileDomain = "customer-success";

export interface ProfileIssue {
  path: string;
  message: string;
}

export class ProfileServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly issues: ProfileIssue[] = [],
  ) {
    super(message);
    this.name = "ProfileServiceError";
  }
}

export interface UserProfileStore {
  getActive(domain: string): Promise<ActiveUserProfileView | null>;
  getVersion(id: string): Promise<UserProfileVersion | null>;
  listVersions(): Promise<UserProfileVersionSummary[]>;
  findFallbackProfile(): Promise<{ id: string; version: number } | null>;
  findLatestEvaluationProfile(
    opportunityId: string,
  ): Promise<{ userProfileId: string | null; userProfileVersion: number | null } | null>;
  setActive(
    domain: string,
    userProfileId: string,
  ): Promise<{ status: "ACTIVATED"; activatedAt: Date } | { status: "NOT_FOUND" }>;
  saveVersion(
    domain: string,
    data: VersionedUserProfileData,
    options: { activate: boolean },
  ): Promise<SaveUserProfileVersionResult>;
}

type ZodInternals = {
  _zod: {
    def: {
      type: string;
      shape?: Record<string, ZodType>;
      catchall?: ZodType;
      innerType?: ZodType;
      element?: ZodType;
      in?: ZodType;
    };
  };
};

function unwrap(schema: ZodType): ZodInternals["_zod"]["def"] {
  let def = (schema as unknown as ZodInternals)._zod.def;
  for (;;) {
    if (def.innerType) def = (def.innerType as unknown as ZodInternals)._zod.def;
    else if (def.type === "pipe" && def.in) def = (def.in as unknown as ZodInternals)._zod.def;
    else return def;
  }
}

// The domain schema strips unknown keys inside some nested preference objects
// instead of rejecting them. The stored document keeps whatever was submitted,
// so an unknown key would be persisted yet silently ignored by evaluation.
// Reject every unknown key with its path instead (read-only schema walk).
function unknownKeyIssues(schema: ZodType, value: unknown, path: string[]): ProfileIssue[] {
  const def = unwrap(schema);
  if (def.type === "object" && def.shape && isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, item]) => {
      const child = def.shape![key];
      if (!child) return [{ path: [...path, key].join("."), message: `Unknown field "${key}"` }];
      return unknownKeyIssues(child, item, [...path, key]);
    });
  }
  if (def.type === "array" && def.element && Array.isArray(value)) {
    return value.flatMap((item, index) => unknownKeyIssues(def.element!, item, [...path, String(index)]));
  }
  return [];
}

function zodIssues(error: z.ZodError, prefix: string[]): ProfileIssue[] {
  return error.issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path.map(String)];
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({ path: [...path, key].join("."), message: `Unknown field "${key}"` }));
    }
    return [{ path: path.join(".") || "(document)", message: issue.message }];
  });
}

function dedupe(issues: ProfileIssue[]): ProfileIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.path}\u0000${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Validates a full profile document with the domain's own validator, plus the
// unknown-key check above. Returns field-level issues instead of throwing.
export function validateProfileDocument(document: unknown):
  | { ok: true; data: VersionedUserProfileData }
  | { ok: false; issues: ProfileIssue[] } {
  if (!isPlainObject(document)) {
    return { ok: false, issues: [{ path: "(document)", message: "The profile must be a JSON object" }] };
  }
  const issues: ProfileIssue[] = [];
  const profile = customerSuccessUserProfileDataSchema.safeParse(document);
  if (!profile.success) issues.push(...zodIssues(profile.error, []));
  const preferences = customerSuccessDomainPreferencesSchema.safeParse(document.domainPreferences ?? null);
  if (!preferences.success) issues.push(...zodIssues(preferences.error, ["domainPreferences"]));
  issues.push(
    ...unknownKeyIssues(customerSuccessDomainPreferencesSchema, document.domainPreferences, ["domainPreferences"]),
  );
  if (issues.length) return { ok: false, issues: dedupe(issues) };
  try {
    // The domain's authoritative check; the stored JSON is never replaced by
    // the parsed result, so unset fields stay unset.
    validateCustomerSuccessUserProfileData(document);
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, issues: dedupe(zodIssues(error, [])) };
    throw error;
  }
  return { ok: true, data: document as unknown as VersionedUserProfileData };
}

// The value each form field takes when it is unset in the stored document.
// Computed by parsing a minimal preferences object with the domain schema
// (read-only); role families have no default, so they have none here.
export function structuredFieldDefaults(): Record<string, unknown> {
  const parsed = customerSuccessPreferencesSchema.safeParse({
    salary: {},
    location: {},
    travel: {},
    workArrangement: {},
    roleFamilies: { continuingClassifications: ["CORE_CS"] },
  });
  if (!parsed.success) return {};
  const defaults: Record<string, unknown> = {};
  for (const field of structuredFields) {
    if (field.path[0] !== "domainPreferences" || field.key.endsWith("roleFamilies.continuingClassifications")) continue;
    const value = readPath({ domainPreferences: { customerSuccess: parsed.data } }, field.path);
    if (value !== undefined) defaults[field.key] = value;
  }
  return defaults;
}

const saveDocumentSchema = z
  .object({
    baseVersionId: z.uuid().nullable(),
    document: z.unknown(),
    activate: z.boolean().default(false),
  })
  .strict();

const saveStructuredSchema = z
  .object({
    baseVersionId: z.uuid(),
    changes: z.record(z.string(), z.unknown()),
    activate: z.boolean().default(false),
  })
  .strict();

const activateSchema = z.object({ userProfileId: z.uuid() }).strict();

function requestIssues(error: z.ZodError): ProfileIssue[] {
  return zodIssues(error, []);
}

export interface ProfileSaveResponse {
  status: "CREATED" | "ALREADY_IMPORTED";
  id: string;
  version: number;
  activated: boolean;
}

export function createProfileService(store: UserProfileStore) {
  async function loadBase(baseVersionId: string) {
    const base = await store.getVersion(baseVersionId);
    if (!base) {
      throw new ProfileServiceError("BASE_VERSION_NOT_FOUND", "The profile version you were editing no longer exists", 404);
    }
    return base;
  }

  async function save(document: unknown, base: UserProfileVersion | null, activate: boolean): Promise<ProfileSaveResponse> {
    if (base && isPlainObject(document) && document.label !== base.label) {
      throw new ProfileServiceError("PROFILE_INVALID", "The profile could not be saved", 400, [
        {
          path: "label",
          message: `The label identifies this profile's version history and cannot be changed (expected "${base.label}")`,
        },
      ]);
    }
    const validation = validateProfileDocument(document);
    if (!validation.ok) {
      throw new ProfileServiceError("PROFILE_INVALID", "The profile could not be saved", 400, validation.issues);
    }
    const result = await store.saveVersion(profileDomain, validation.data, { activate });
    return { status: result.status, id: result.id, version: result.version, activated: result.activated };
  }

  async function effectiveProfile() {
    const active = await store.getActive(profileDomain);
    if (active) return { id: active.userProfileId, version: active.version };
    return store.findFallbackProfile();
  }

  return {
    // Informational only: whether the opportunity's latest evaluation used a
    // different profile version than new evaluations would use now. Nothing
    // is re-evaluated or rebound.
    async profileVersionHint(opportunityId: string) {
      const [evaluated, current] = await Promise.all([
        store.findLatestEvaluationProfile(opportunityId),
        effectiveProfile(),
      ]);
      if (!evaluated?.userProfileId || evaluated.userProfileVersion === null || !current) return null;
      if (evaluated.userProfileId === current.id) return null;
      return { evaluatedVersion: evaluated.userProfileVersion, currentVersion: current.version };
    },

    async overview() {
      const [active, versions] = await Promise.all([store.getActive(profileDomain), store.listVersions()]);
      const effective = active
        ? { userProfileId: active.userProfileId, version: active.version, label: active.label, activatedAt: active.activatedAt, explicit: true }
        : await store.findFallbackProfile().then((fallback) => {
            if (!fallback) return null;
            const summary = versions.find((item) => item.id === fallback.id);
            return { userProfileId: fallback.id, version: fallback.version, label: summary?.label ?? "", activatedAt: null, explicit: false };
          });
      return { domain: profileDomain, active: effective, versions };
    },

    async getVersion(idValue: string) {
      const id = z.uuid().safeParse(idValue);
      if (!id.success) throw new ProfileServiceError("PROFILE_VERSION_NOT_FOUND", "Profile version not found", 404);
      const version = await store.getVersion(id.data);
      if (!version) throw new ProfileServiceError("PROFILE_VERSION_NOT_FOUND", "Profile version not found", 404);
      return version;
    },

    async saveDocument(body: unknown) {
      const parsed = saveDocumentSchema.safeParse(body);
      if (!parsed.success) {
        throw new ProfileServiceError("REQUEST_INVALID", "The profile request is invalid", 400, requestIssues(parsed.error));
      }
      const { baseVersionId, document, activate } = parsed.data;
      if (baseVersionId === null) {
        // Only the very first profile may be created without a base version.
        if ((await store.listVersions()).length > 0) {
          throw new ProfileServiceError("BASE_VERSION_REQUIRED", "Choose the profile version you are editing", 409);
        }
        return save(document, null, activate);
      }
      return save(document, await loadBase(baseVersionId), activate);
    },

    async saveStructured(body: unknown) {
      const parsed = saveStructuredSchema.safeParse(body);
      if (!parsed.success) {
        throw new ProfileServiceError("REQUEST_INVALID", "The profile request is invalid", 400, requestIssues(parsed.error));
      }
      const base = await loadBase(parsed.data.baseVersionId);
      let document: ProfileDocument;
      try {
        document = applyStructuredChanges(base.document as unknown as ProfileDocument, parsed.data.changes);
      } catch (error) {
        if (error instanceof StructuredChangeError) {
          throw new ProfileServiceError("PROFILE_INVALID", "The profile could not be saved", 400, [
            { path: error.path, message: error.message },
          ]);
        }
        throw error;
      }
      return save(document, base, parsed.data.activate);
    },

    async activate(body: unknown) {
      const parsed = activateSchema.safeParse(body);
      if (!parsed.success) {
        throw new ProfileServiceError("REQUEST_INVALID", "The activation request is invalid", 400, requestIssues(parsed.error));
      }
      const version = await store.getVersion(parsed.data.userProfileId);
      if (!version) throw new ProfileServiceError("PROFILE_VERSION_NOT_FOUND", "Profile version not found", 404);
      const validation = validateProfileDocument(version.document);
      if (!validation.ok) {
        throw new ProfileServiceError(
          "PROFILE_NOT_USABLE",
          "This version does not contain valid Customer Success preferences and cannot be made active",
          422,
          validation.issues,
        );
      }
      const result = await store.setActive(profileDomain, version.id);
      if (result.status === "NOT_FOUND") {
        throw new ProfileServiceError("PROFILE_VERSION_NOT_FOUND", "Profile version not found", 404);
      }
      return { userProfileId: version.id, version: version.version, activatedAt: result.activatedAt };
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;

let profileService: ProfileService | undefined;

export function getProfileService(): ProfileService {
  profileService ??= createProfileService(new PrismaUserProfileRepository());
  return profileService;
}

function errorResponse(error: unknown) {
  if (error instanceof ProfileServiceError) {
    return Response.json(
      { error: error.message, code: error.code, ...(error.issues.length ? { issues: error.issues } : {}) },
      { status: error.status },
    );
  }
  console.error("Profile request failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return Response.json({ error: "The profile request could not be completed", code: "INTERNAL_ERROR" }, { status: 500 });
}

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Request body must be valid JSON", code: "REQUEST_INVALID" }, { status: 400 }),
    };
  }
}

function saveResponse(result: ProfileSaveResponse) {
  return Response.json(result, { status: result.status === "CREATED" ? 201 : 200 });
}

export function createProfileApiHandlers(service: ProfileService) {
  return {
    async getOverview() {
      try {
        return Response.json(await service.overview());
      } catch (error) {
        return errorResponse(error);
      }
    },
    async getVersion(id: string) {
      try {
        return Response.json(await service.getVersion(id));
      } catch (error) {
        return errorResponse(error);
      }
    },
    async postDocument(request: Request) {
      const body = await readJson(request);
      if (!body.ok) return body.response;
      try {
        return saveResponse(await service.saveDocument(body.body));
      } catch (error) {
        return errorResponse(error);
      }
    },
    async postStructured(request: Request) {
      const body = await readJson(request);
      if (!body.ok) return body.response;
      try {
        return saveResponse(await service.saveStructured(body.body));
      } catch (error) {
        return errorResponse(error);
      }
    },
    async postActive(request: Request) {
      const body = await readJson(request);
      if (!body.ok) return body.response;
      try {
        return Response.json(await service.activate(body.body));
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

export function getProfileApiHandlers() {
  return createProfileApiHandlers(getProfileService());
}
