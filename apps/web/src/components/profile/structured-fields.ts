// The profile fields the structured form can edit, and the pure helpers both
// editors and the server share. This module is the form's allowlist: a field
// that is not listed here is only editable in the JSON editor. It does not
// import the domain package, so it stays safe for client bundles; a unit test
// asserts every option list matches the Customer Success schema exactly.

export type FieldKind =
  | "text"
  | "number"
  | "boolean"
  | "enumSingle"
  | "enumMulti"
  | "stringList"
  | "statements"
  | "experience";

export interface StructuredField {
  key: string;
  path: readonly string[];
  kind: FieldKind;
  label: string;
  help?: string;
  options?: readonly string[];
  // Object-level validation messages (for example the salary threshold rule)
  // are shown on this field.
  objectErrorPaths?: readonly string[];
  idPrefix?: string;
}

export type ProfileDocument = Record<string, unknown>;
export type StructuredChanges = Record<string, unknown>;

export interface FieldGroup {
  id: string;
  title: string;
  description: string;
  fields: StructuredField[];
}

const cs = ["domainPreferences", "customerSuccess"] as const;
const csKey = (...path: string[]) => [...cs, ...path].join(".");
const csField = (
  path: string[],
  field: Omit<StructuredField, "key" | "path">,
): StructuredField => ({ key: csKey(...path), path: [...cs, ...path], ...field });
const profileField = (
  name: string,
  field: Omit<StructuredField, "key" | "path">,
): StructuredField => ({ key: name, path: [name], ...field });

export const workArrangementOptions = ["REMOTE", "HYBRID", "ONSITE"] as const;
export const unknownArrangementOptions = ["REVIEW", "UNKNOWN"] as const;
export const roleFamilyOptions = [
  "CORE_CS",
  "CS_ADJACENT",
  "SUPPORT_HEAVY",
  "SALES_HEAVY",
  "IMPLEMENTATION_HEAVY",
  "TECHNICAL_CS",
] as const;
export const businessModelOptions = [
  "SAAS",
  "SOFTWARE",
  "TECHNOLOGY",
  "EDTECH",
  "MARKETPLACE",
  "SUBSCRIPTION",
  "OTHER",
] as const;
export const productTypeOptions = [
  "WORKFLOW",
  "PRODUCTIVITY",
  "COLLABORATION",
  "LEARNING",
  "AUTOMATION",
  "NO_CODE",
  "LOW_CODE",
  "MODERATELY_TECHNICAL",
  "DEVELOPER_FOCUSED",
  "OTHER",
] as const;
export const customerTypeOptions = [
  "B2C",
  "B2B2C",
  "LIGHT_B2B",
  "ENTERPRISE_HEAVY_B2B",
  "MIXED",
] as const;
export const customerSegmentOptions = [
  "SMB",
  "MID_MARKET",
  "COMMERCIAL",
  "ENTERPRISE",
  "MIXED",
] as const;
export const fitAreaOptions = [
  "ONBOARDING",
  "EDUCATION",
  "ENABLEMENT",
  "RELATIONSHIP_MANAGEMENT",
  "ENGAGEMENT",
  "RETENTION",
  "ADOPTION",
  "CUSTOMER_INSIGHTS",
  "CROSS_FUNCTIONAL_COLLABORATION",
  "DOCUMENTATION",
  "PROBLEM_SOLVING",
  "STRATEGY",
  "MODERATE_SALES",
  "RENEWALS",
  "EXPANSION",
  "METRICS",
  "ADOPTION_TRACKING",
  "PRODUCT_FEEDBACK",
  "ANALYSIS",
] as const;
export const lowerAlignmentOptions = [
  "REACTIVE_SUPPORT",
  "CALL_CENTER_WORK",
  "CONSTANT_INTERRUPTION",
  "MEETING_HEAVY_WORK",
  "CALL_VOLUME_KPIS",
  "LITTLE_STRATEGIC_RESPONSIBILITY",
] as const;
export const workStyleOptions = [
  "ASYNC_WORK",
  "DEEP_WORK",
  "DOCUMENTATION",
  "PROCESS_IMPROVEMENT",
  "EDUCATION",
  "CROSS_FUNCTIONAL_COLLABORATION",
  "FEEDBACK_LOOPS",
  "STRATEGIC_OWNERSHIP",
] as const;
export const experienceRelationshipOptions = ["DIRECT", "RELATED", "TRANSFERABLE"] as const;

export const fieldGroups: FieldGroup[] = [
  {
    id: "hard-filters",
    title: "Dealbreakers & hard filters",
    description: "Hard requirements every opportunity is checked against before fit is assessed.",
    fields: [
      csField(["salary", "currency"], { kind: "text", label: "Salary currency" }),
      csField(["salary", "passMinimum"], {
        kind: "number",
        label: "Salary that passes",
        help: "Base salary at or above this passes the salary filter.",
        objectErrorPaths: [csKey("salary")],
      }),
      csField(["salary", "reviewMinimum"], {
        kind: "number",
        label: "Salary that needs review",
        help: "Below the passing salary but at or above this is flagged for review. Must be lower than the passing salary.",
      }),
      csField(["salary", "substantiallyLowerCostCountries"], {
        kind: "stringList",
        label: "Substantially lower-cost countries",
        help: "Countries where a lower salary can still be reasonable.",
      }),
      csField(["workArrangement", "allowed"], {
        kind: "enumMulti",
        label: "Allowed work arrangements",
        options: workArrangementOptions,
      }),
      csField(["workArrangement", "unknownResult"], {
        kind: "enumSingle",
        label: "When the work arrangement is not stated",
        options: unknownArrangementOptions,
      }),
      csField(["location", "allowedCountries"], { kind: "stringList", label: "Allowed countries" }),
      csField(["location", "disallowedCountries"], { kind: "stringList", label: "Disallowed countries" }),
      csField(["location", "allowUnitedStatesOnlyRoles"], {
        kind: "boolean",
        label: "Allow roles restricted to United States residents",
      }),
      csField(["travel", "allowInfrequentCompanyEvents"], {
        kind: "boolean",
        label: "Allow infrequent company events",
      }),
      csField(["travel", "allowExceptionalCustomerVisits"], {
        kind: "boolean",
        label: "Allow exceptional customer visits",
      }),
      csField(["roleFamilies", "continuingClassifications"], {
        kind: "enumMulti",
        label: "Role families that continue to evaluation",
        help: "Opportunities classified outside these families stop at the role-family filter. Choose at least one.",
        options: roleFamilyOptions,
      }),
    ],
  },
  {
    id: "fit",
    title: "Target roles & fit",
    description: "The Customer Success work you want, can do, and want less of.",
    fields: [
      csField(["fitPreferences", "preferredAreas"], { kind: "enumMulti", label: "Preferred areas", options: fitAreaOptions }),
      csField(["fitPreferences", "comfortableAreas"], { kind: "enumMulti", label: "Comfortable areas", options: fitAreaOptions }),
      csField(["fitPreferences", "lowerAlignmentPatterns"], {
        kind: "enumMulti",
        label: "Lower-alignment patterns",
        options: lowerAlignmentOptions,
      }),
      csField(["workStylePreferences", "preferred"], {
        kind: "enumMulti",
        label: "Preferred work styles",
        options: workStyleOptions,
      }),
    ],
  },
  {
    id: "company",
    title: "Company, product & customers",
    description: "The businesses, products, and customers you want to work with.",
    fields: [
      csField(["companyPreferences", "preferredBusinessModels"], {
        kind: "enumMulti",
        label: "Preferred business models",
        options: businessModelOptions,
      }),
      csField(["companyPreferences", "alsoAlignedBusinessModels"], {
        kind: "enumMulti",
        label: "Also-aligned business models",
        options: businessModelOptions,
      }),
      csField(["productPreferences", "preferredProductTypes"], {
        kind: "enumMulti",
        label: "Preferred product types",
        options: productTypeOptions,
      }),
      csField(["customerPreferences", "customerTypes"], {
        kind: "enumMulti",
        label: "Customer types",
        options: customerTypeOptions,
      }),
      csField(["customerPreferences", "customerSegments"], {
        kind: "enumMulti",
        label: "Customer segments",
        options: customerSegmentOptions,
      }),
    ],
  },
  {
    id: "career",
    title: "Career direction",
    description: "Where you want your career to go.",
    fields: [
      csField(["careerStrategy", "goals"], { kind: "stringList", label: "Career-strategy goals" }),
      profileField("careerGoals", { kind: "statements", label: "Career goals", idPrefix: "career" }),
    ],
  },
  {
    id: "experience",
    title: "Experience & skills",
    description: "Statements used as candidate profile evidence when opportunities are evaluated.",
    fields: [
      profileField("experience", { kind: "experience", label: "Experience", idPrefix: "experience", options: experienceRelationshipOptions }),
      profileField("skills", { kind: "statements", label: "Skills", idPrefix: "skill" }),
      profileField("transferableSkills", { kind: "statements", label: "Transferable skills", idPrefix: "transferable" }),
      profileField("workPreferences", { kind: "statements", label: "Work preferences", idPrefix: "work" }),
    ],
  },
];

export const structuredFields: StructuredField[] = fieldGroups.flatMap((group) => group.fields);
const fieldsByKey = new Map(structuredFields.map((field) => [field.key, field]));

export function findField(key: string): StructuredField | undefined {
  return fieldsByKey.get(key);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Structural equality that ignores object key order.
export function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => deepEqual(item, right[index]))
    );
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]))
    );
  }
  return false;
}

// The stored value at a path, or undefined when the field is unset.
export function readPath(document: unknown, path: readonly string[]): unknown {
  let current: unknown = document;
  for (const segment of path) {
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function isStatement(value: unknown, withRelationship: boolean): boolean {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = withRelationship ? ["id", "relationship", "statement"] : ["id", "statement"];
  return (
    deepEqual(keys, expected) &&
    typeof value.id === "string" &&
    typeof value.statement === "string" &&
    (!withRelationship ||
      (experienceRelationshipOptions as readonly string[]).includes(value.relationship as string))
  );
}

// Whether a value has the shape the field's input can display and edit.
// Content rules (non-empty text, at least one role family, the salary
// threshold) are left to the domain validator on save.
export function fitsField(field: StructuredField, value: unknown): boolean {
  switch (field.kind) {
    case "text":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "enumSingle":
      return typeof value === "string" && (field.options ?? []).includes(value);
    case "enumMulti":
      return (
        Array.isArray(value) &&
        value.every((item) => typeof item === "string" && (field.options ?? []).includes(item)) &&
        new Set(value).size === value.length
      );
    case "stringList":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
    case "statements":
      return Array.isArray(value) && value.every((item) => isStatement(item, false));
    case "experience":
      return Array.isArray(value) && value.every((item) => isStatement(item, true));
  }
}

export class StructuredChangeError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "StructuredChangeError";
  }
}

function cloneDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Applies allowlisted field changes to a deep copy of the base document. Only
// the changed paths are written, so untouched unset fields stay unset.
export function applyStructuredChanges(
  base: ProfileDocument,
  changes: StructuredChanges,
): ProfileDocument {
  const result = cloneDocument(base);
  for (const [key, value] of Object.entries(changes)) {
    const field = findField(key);
    if (!field) throw new StructuredChangeError(key, "This field cannot be edited in the form");
    if (!fitsField(field, value)) {
      throw new StructuredChangeError(
        key,
        field.kind === "number" ? "Enter a number" : "This value does not match the field",
      );
    }
    let target: Record<string, unknown> = result;
    for (const segment of field.path.slice(0, -1)) {
      const next = target[segment];
      if (next === undefined || next === null) {
        target[segment] = {};
      } else if (!isPlainObject(next)) {
        throw new StructuredChangeError(key, "The stored profile has an unexpected shape here; edit it in JSON");
      }
      target = target[segment] as Record<string, unknown>;
    }
    target[field.path[field.path.length - 1]!] = cloneDocument(value);
  }
  return result;
}

function differingPaths(left: unknown, right: unknown, prefix: string[], output: string[]) {
  if (deepEqual(left, right)) return;
  if (isPlainObject(left) && isPlainObject(right)) {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      differingPaths(left[key], right[key], [...prefix, key], output);
    }
    return;
  }
  output.push(prefix.join(".") || "(document)");
}

export type JsonToStructuredResult =
  | { ok: true; changes: StructuredChanges }
  | { ok: false; reason: string };

export function parseProfileJson(text: string):
  | { ok: true; document: ProfileDocument }
  | { ok: false; message: string; line?: number; column?: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The JSON could not be read";
    const position = /position (\d+)/.exec(message);
    if (!position) return { ok: false, message };
    const before = text.slice(0, Number(position[1]));
    const lines = before.split("\n");
    return {
      ok: false,
      message: message.replace(/ in JSON at position \d+.*$/, ""),
      line: lines.length,
      column: lines[lines.length - 1]!.length + 1,
    };
  }
  if (!isPlainObject(parsed)) return { ok: false, message: "The profile must be a JSON object" };
  return { ok: true, document: parsed };
}

// Converts an edited JSON document back into form changes, but only when the
// conversion is lossless: every difference from the base must be an
// allowlisted form field holding a value the form can display. Anything else
// returns a reason instead, so the caller can ask before discarding.
export function diffToStructuredChanges(
  base: ProfileDocument,
  editedText: string,
): JsonToStructuredResult {
  const parsed = parseProfileJson(editedText);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.line
        ? `The JSON is not valid (line ${parsed.line}, column ${parsed.column}: ${parsed.message}).`
        : `The JSON is not valid: ${parsed.message}.`,
    };
  }
  const edited = parsed.document;
  const changes: StructuredChanges = {};
  for (const field of structuredFields) {
    const before = readPath(base, field.path);
    const after = readPath(edited, field.path);
    if (deepEqual(before, after)) continue;
    if (after === undefined) {
      return { ok: false, reason: `${field.label} was removed, which the form cannot show.` };
    }
    if (!fitsField(field, after)) {
      return { ok: false, reason: `${field.label} has a value the form cannot show.` };
    }
    changes[field.key] = after;
  }
  let reconstructed: ProfileDocument;
  try {
    reconstructed = applyStructuredChanges(base, changes);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "The form cannot show these changes." };
  }
  if (!deepEqual(reconstructed, edited)) {
    const paths: string[] = [];
    differingPaths(reconstructed, edited, [], paths);
    const shown = paths.slice(0, 3).join(", ");
    return {
      ok: false,
      reason: `These changes can only be edited in JSON: ${shown}${paths.length > 3 ? ` and ${paths.length - 3} more` : ""}.`,
    };
  }
  return { ok: true, changes };
}

export function formatProfileJson(document: ProfileDocument): string {
  return JSON.stringify(document, null, 2);
}
