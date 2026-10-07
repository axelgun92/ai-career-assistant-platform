import { describe, expect, it, vi } from "vitest";
import {
  businessModelPreferenceSchema,
  customerSegmentPreferenceSchema,
  customerSuccessFitAreaSchema,
  customerSuccessLowerAlignmentPatternSchema,
  customerSuccessPreferencesSchema,
  customerSuccessWorkStyleSchema,
  customerTypePreferenceSchema,
  experienceRelationshipSchema,
  productTypePreferenceSchema,
} from "@ai-career/customer-success";
import type { UserProfileVersion } from "@ai-career/database";
import {
  applyStructuredChanges,
  diffToStructuredChanges,
  findField,
  formatProfileJson,
  parseProfileJson,
  readPath,
  StructuredChangeError,
  structuredFields,
  type ProfileDocument,
} from "../../apps/web/src/components/profile/structured-fields";
import { issuesByField } from "../../apps/web/src/components/profile/labels";
import {
  createProfileApiHandlers,
  createProfileService,
  structuredFieldDefaults,
  validateProfileDocument,
  type UserProfileStore,
} from "../../apps/web/src/server/profile-service";

const baseId = "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11";
const otherId = "7a2d8b4f-2e66-4b4c-8c8f-1e3c9b2f5d22";
const cs = "domainPreferences.customerSuccess";

// A valid profile whose optional preference groups are unset, so defaults
// apply at evaluation time.
function minimalDocument(): ProfileDocument {
  return {
    label: "Unit profile",
    careerGoals: [{ id: "goal-1", statement: "Grow into strategic Customer Success." }],
    experience: [{ id: "exp-1", statement: "Led onboarding.", relationship: "DIRECT" }],
    skills: [{ id: "skill-1", statement: "Customer enablement" }],
    transferableSkills: null,
    locationPreferences: { note: "generic, not read by Customer Success" },
    compensationPreferences: null,
    workPreferences: null,
    companyPreferences: null,
    domainPreferences: {
      customerSuccess: {
        salary: { passMinimum: 70_000, reviewMinimum: 60_000 },
        location: {},
        travel: {},
        workArrangement: {},
        roleFamilies: { continuingClassifications: ["CORE_CS"] },
      },
    },
  };
}

function version(document: ProfileDocument, id = baseId, versionNumber = 1): UserProfileVersion {
  return {
    id,
    label: String(document.label),
    version: versionNumber,
    contentHash: "hash",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    document: document as unknown as UserProfileVersion["document"],
  };
}

function store(overrides: Partial<UserProfileStore> = {}): UserProfileStore {
  return {
    getActive: vi.fn().mockResolvedValue(null),
    getVersion: vi.fn().mockImplementation(async (id: string) => (id === baseId ? version(minimalDocument()) : null)),
    listVersions: vi.fn().mockResolvedValue([
      { id: baseId, label: "Unit profile", version: 1, createdAt: new Date(), evaluationCount: 2 },
    ]),
    findFallbackProfile: vi.fn().mockResolvedValue({ id: baseId, version: 1 }),
    findLatestEvaluationProfile: vi.fn().mockResolvedValue(null),
    setActive: vi.fn().mockResolvedValue({ status: "ACTIVATED", activatedAt: new Date("2026-10-07T00:00:00Z") }),
    saveVersion: vi.fn().mockResolvedValue({ status: "CREATED", id: otherId, version: 2, contentHash: "h2", activated: false }),
    ...overrides,
  };
}

describe("structured field allowlist", () => {
  it("offers exactly the option lists the Customer Success contract defines", () => {
    const options = (key: string) => [...(findField(key)!.options ?? [])];
    expect(options(`${cs}.workArrangement.allowed`)).toEqual(["REMOTE", "HYBRID", "ONSITE"]);
    expect(options(`${cs}.workArrangement.unknownResult`)).toEqual(["REVIEW", "UNKNOWN"]);
    const roleFamilies = customerSuccessPreferencesSchema.shape.roleFamilies.shape.continuingClassifications.element.options;
    expect(options(`${cs}.roleFamilies.continuingClassifications`)).toEqual(roleFamilies);
    expect(options(`${cs}.companyPreferences.preferredBusinessModels`)).toEqual(businessModelPreferenceSchema.options);
    expect(options(`${cs}.companyPreferences.alsoAlignedBusinessModels`)).toEqual(businessModelPreferenceSchema.options);
    expect(options(`${cs}.productPreferences.preferredProductTypes`)).toEqual(productTypePreferenceSchema.options);
    expect(options(`${cs}.customerPreferences.customerTypes`)).toEqual(customerTypePreferenceSchema.options);
    expect(options(`${cs}.customerPreferences.customerSegments`)).toEqual(customerSegmentPreferenceSchema.options);
    expect(options(`${cs}.fitPreferences.preferredAreas`)).toEqual(customerSuccessFitAreaSchema.options);
    expect(options(`${cs}.fitPreferences.comfortableAreas`)).toEqual(customerSuccessFitAreaSchema.options);
    expect(options(`${cs}.fitPreferences.lowerAlignmentPatterns`)).toEqual(customerSuccessLowerAlignmentPatternSchema.options);
    expect(options(`${cs}.workStylePreferences.preferred`)).toEqual(customerSuccessWorkStyleSchema.options);
    expect(options("experience")).toEqual(experienceRelationshipSchema.options);
  });

  it("only exposes paths that exist in the profile contract", () => {
    const preferenceShape = customerSuccessPreferencesSchema.shape as Record<string, unknown>;
    for (const field of structuredFields) {
      if (field.path[0] === "domainPreferences") {
        expect(field.path.slice(0, 2)).toEqual(["domainPreferences", "customerSuccess"]);
        expect(Object.keys(preferenceShape)).toContain(field.path[2]);
      } else {
        expect(["careerGoals", "experience", "skills", "transferableSkills", "workPreferences"]).toContain(field.key);
      }
    }
  });
});

describe("applyStructuredChanges", () => {
  it("writes only the changed paths and leaves untouched unset fields unset", () => {
    const base = minimalDocument();
    const result = applyStructuredChanges(base, {
      [`${cs}.salary.passMinimum`]: 80_000,
      [`${cs}.fitPreferences.preferredAreas`]: ["ONBOARDING"],
    });
    expect(readPath(result, ["domainPreferences", "customerSuccess", "salary"])).toEqual({
      passMinimum: 80_000,
      reviewMinimum: 60_000,
    });
    expect(readPath(result, ["domainPreferences", "customerSuccess", "fitPreferences"])).toEqual({
      preferredAreas: ["ONBOARDING"],
    });
    expect(readPath(result, ["domainPreferences", "customerSuccess", "companyPreferences"])).toBeUndefined();
    expect(readPath(result, ["domainPreferences", "customerSuccess", "salary", "currency"])).toBeUndefined();
    expect(result.locationPreferences).toEqual(base.locationPreferences);
    expect(base).toEqual(minimalDocument());
  });

  it("rejects paths outside the allowlist and values that do not fit the field", () => {
    expect(() => applyStructuredChanges(minimalDocument(), { "locationPreferences.note": "x" })).toThrow(StructuredChangeError);
    expect(() => applyStructuredChanges(minimalDocument(), { label: "Renamed" })).toThrow(StructuredChangeError);
    expect(() => applyStructuredChanges(minimalDocument(), { [`${cs}.salary.passMinimum`]: "80k" })).toThrow("Enter a number");
    expect(() => applyStructuredChanges(minimalDocument(), { [`${cs}.workArrangement.allowed`]: ["MOON"] })).toThrow(
      StructuredChangeError,
    );
  });
});

describe("diffToStructuredChanges", () => {
  const base = minimalDocument();
  const edit = (mutate: (document: ProfileDocument) => void) => {
    const document = JSON.parse(JSON.stringify(base)) as ProfileDocument;
    mutate(document);
    return formatProfileJson(document);
  };

  it("converts form-representable JSON edits into form changes", () => {
    const result = diffToStructuredChanges(
      base,
      edit((document) => {
        const preferences = (document.domainPreferences as { customerSuccess: Record<string, Record<string, unknown>> }).customerSuccess;
        preferences.salary!.passMinimum = 90_000;
        preferences.customerPreferences = { customerSegments: ["SMB"] };
        (document.skills as unknown[]).push({ id: "skill-2", statement: "Workshops" });
      }),
    );
    expect(result).toEqual({
      ok: true,
      changes: {
        [`${cs}.salary.passMinimum`]: 90_000,
        [`${cs}.customerPreferences.customerSegments`]: ["SMB"],
        skills: [
          { id: "skill-1", statement: "Customer enablement" },
          { id: "skill-2", statement: "Workshops" },
        ],
      },
    });
  });

  it("returns no changes for a whitespace-only edit", () => {
    expect(diffToStructuredChanges(base, JSON.stringify(base))).toEqual({ ok: true, changes: {} });
  });

  it("refuses parse errors, non-form edits, removed fields, and values the form cannot show", () => {
    const parse = diffToStructuredChanges(base, "{\n  \"label\": \"x\",\n  oops\n}");
    expect(parse).toMatchObject({ ok: false, reason: expect.stringMatching(/line 3, column 3/) });
    expect(diffToStructuredChanges(base, edit((document) => { document.locationPreferences = { note: "changed" }; })))
      .toMatchObject({ ok: false, reason: expect.stringContaining("locationPreferences.note") });
    expect(diffToStructuredChanges(base, edit((document) => {
      delete ((document.domainPreferences as { customerSuccess: { salary: Record<string, unknown> } }).customerSuccess.salary).passMinimum;
    }))).toMatchObject({ ok: false, reason: expect.stringContaining("removed") });
    expect(diffToStructuredChanges(base, edit((document) => {
      ((document.domainPreferences as { customerSuccess: { salary: Record<string, unknown> } }).customerSuccess.salary).passMinimum = "lots";
    }))).toMatchObject({ ok: false, reason: expect.stringContaining("cannot show") });
    expect(diffToStructuredChanges(base, edit((document) => {
      ((document.domainPreferences as { customerSuccess: { salary: Record<string, unknown> } }).customerSuccess.salary).bonus = 1;
    }))).toMatchObject({ ok: false, reason: expect.stringContaining("salary.bonus") });
  });

  it("reports JSON parse errors with line and column", () => {
    expect(parseProfileJson("{\n  \"a\": 1,\n  x\n}")).toMatchObject({ ok: false, line: 3, column: 3 });
    expect(parseProfileJson("[1]")).toEqual({ ok: false, message: "The profile must be a JSON object" });
  });
});

describe("profile document validation", () => {
  it("accepts a valid document without filling in defaults", () => {
    const document = minimalDocument();
    const result = validateProfileDocument(document);
    expect(result.ok).toBe(true);
    expect(document).toEqual(minimalDocument());
  });

  it("maps domain rule failures and unknown keys to paths", () => {
    const document = minimalDocument();
    const preferences = (document.domainPreferences as { customerSuccess: Record<string, Record<string, unknown>> }).customerSuccess;
    preferences.salary = { passMinimum: 50_000, reviewMinimum: 60_000, bonus: true };
    preferences.roleFamilies = { continuingClassifications: [] };
    (document as Record<string, unknown>).nickname = "Al";
    const result = validateProfileDocument(document);
    expect(result.ok).toBe(false);
    const issues = result.ok ? [] : result.issues;
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: `${cs}.salary`, message: "The salary pass threshold must exceed the review threshold" },
        { path: `${cs}.salary.bonus`, message: 'Unknown field "bonus"' },
        expect.objectContaining({ path: `${cs}.roleFamilies.continuingClassifications` }),
        { path: "nickname", message: 'Unknown field "nickname"' },
      ]),
    );
    const { fieldErrors } = issuesByField(issues);
    expect(fieldErrors[`${cs}.salary.passMinimum`]).toContain("The salary pass threshold must exceed the review threshold");
    expect(fieldErrors[`${cs}.roleFamilies.continuingClassifications`]).toHaveLength(1);
  });

  it("computes effective defaults from the domain schema, with none for role families", () => {
    const defaults = structuredFieldDefaults();
    expect(defaults[`${cs}.salary.currency`]).toBe("USD");
    expect(defaults[`${cs}.workArrangement.allowed`]).toEqual(["REMOTE"]);
    expect(defaults[`${cs}.companyPreferences.preferredBusinessModels`]).toEqual(["SAAS", "SOFTWARE", "TECHNOLOGY"]);
    expect(defaults).not.toHaveProperty(`${cs}.roleFamilies.continuingClassifications`);
    expect(defaults).not.toHaveProperty("skills");
  });
});

describe("profile service", () => {
  it("saves structured changes applied to the base version, without activating", async () => {
    const profiles = store();
    const result = await createProfileService(profiles).saveStructured({
      baseVersionId: baseId,
      changes: { [`${cs}.salary.passMinimum`]: 75_000 },
    });
    expect(result).toEqual({ status: "CREATED", id: otherId, version: 2, activated: false });
    expect(profiles.saveVersion).toHaveBeenCalledTimes(1);
    const [domain, data, options] = vi.mocked(profiles.saveVersion).mock.calls[0]!;
    expect(domain).toBe("customer-success");
    expect(options).toEqual({ activate: false });
    expect(readPath(data, ["domainPreferences", "customerSuccess", "salary"])).toEqual({ passMinimum: 75_000, reviewMinimum: 60_000 });
    expect(readPath(data, ["domainPreferences", "customerSuccess", "fitPreferences"])).toBeUndefined();
  });

  it("rejects a changed label, an invalid document, and a missing base without saving", async () => {
    const profiles = store();
    const service = createProfileService(profiles);
    await expect(
      service.saveDocument({ baseVersionId: baseId, document: { ...minimalDocument(), label: "Renamed" } }),
    ).rejects.toMatchObject({ code: "PROFILE_INVALID", status: 400, issues: [expect.objectContaining({ path: "label" })] });
    await expect(
      service.saveDocument({ baseVersionId: baseId, document: { ...minimalDocument(), domainPreferences: null } }),
    ).rejects.toMatchObject({ code: "PROFILE_INVALID", issues: expect.arrayContaining([expect.objectContaining({ path: "domainPreferences" })]) });
    await expect(service.saveDocument({ baseVersionId: otherId, document: minimalDocument() })).rejects.toMatchObject({
      code: "BASE_VERSION_NOT_FOUND",
      status: 404,
    });
    await expect(service.saveDocument({ baseVersionId: null, document: minimalDocument() })).rejects.toMatchObject({
      code: "BASE_VERSION_REQUIRED",
      status: 409,
    });
    expect(profiles.saveVersion).not.toHaveBeenCalled();
  });

  it("activates only versions that are valid for the domain", async () => {
    const invalid = minimalDocument();
    invalid.domainPreferences = null;
    const profiles = store({
      getVersion: vi.fn().mockImplementation(async (id: string) =>
        id === baseId ? version(minimalDocument()) : id === otherId ? version(invalid, otherId, 2) : null),
    });
    const service = createProfileService(profiles);
    await expect(service.activate({ userProfileId: baseId })).resolves.toMatchObject({ userProfileId: baseId, version: 1 });
    await expect(service.activate({ userProfileId: otherId })).rejects.toMatchObject({ code: "PROFILE_NOT_USABLE", status: 422 });
    expect(profiles.setActive).toHaveBeenCalledTimes(1);
    expect(profiles.setActive).toHaveBeenCalledWith("customer-success", baseId);
  });

  it("hints only when the latest evaluation used a different version than new evaluations would", async () => {
    const hint = (evaluated: { userProfileId: string | null; userProfileVersion: number | null } | null) =>
      createProfileService(store({
        getActive: vi.fn().mockResolvedValue({ domain: "customer-success", userProfileId: otherId, version: 2, label: "x", activatedAt: new Date() }),
        findLatestEvaluationProfile: vi.fn().mockResolvedValue(evaluated),
      })).profileVersionHint(baseId);
    await expect(hint({ userProfileId: baseId, userProfileVersion: 1 })).resolves.toEqual({ evaluatedVersion: 1, currentVersion: 2 });
    await expect(hint({ userProfileId: otherId, userProfileVersion: 2 })).resolves.toBeNull();
    await expect(hint(null)).resolves.toBeNull();
    await expect(hint({ userProfileId: null, userProfileVersion: null })).resolves.toBeNull();
  });
});

describe("profile API handlers", () => {
  const post = (body: string) => new Request("http://localhost/api/profile", { method: "POST", body });

  it("returns 201 for a new version and 200 for identical content", async () => {
    const created = createProfileApiHandlers(createProfileService(store()));
    const response = await created.postDocument(post(JSON.stringify({ baseVersionId: baseId, document: minimalDocument() })));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "CREATED", id: otherId, version: 2, activated: false });

    const existing = createProfileApiHandlers(createProfileService(store({
      saveVersion: vi.fn().mockResolvedValue({ status: "ALREADY_IMPORTED", id: baseId, version: 1, contentHash: "h", activated: true }),
    })));
    const same = await existing.postDocument(post(JSON.stringify({ baseVersionId: baseId, document: minimalDocument(), activate: true })));
    expect(same.status).toBe(200);
    expect(await same.json()).toMatchObject({ status: "ALREADY_IMPORTED", activated: true });
  });

  it("returns 400 with issues, 404, and 409 without leaking internals", async () => {
    const handlers = createProfileApiHandlers(createProfileService(store()));
    expect((await handlers.postDocument(post("{not json"))).status).toBe(400);
    const invalid = await handlers.postStructured(post(JSON.stringify({ baseVersionId: baseId, changes: { label: "x" } })));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "PROFILE_INVALID", issues: [{ path: "label" }] });
    expect((await handlers.postActive(post(JSON.stringify({ userProfileId: otherId })))).status).toBe(404);
    expect((await handlers.getVersion("not-a-uuid")).status).toBe(404);
    expect((await handlers.postDocument(post(JSON.stringify({ baseVersionId: null, document: {} })))).status).toBe(409);

    const failing = createProfileApiHandlers(createProfileService(store({
      listVersions: vi.fn().mockRejectedValue(new TypeError("connect ECONNREFUSED secret-host")),
    })));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await failing.getOverview();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret-host");
    error.mockRestore();
  });
});
