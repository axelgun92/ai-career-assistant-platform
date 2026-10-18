import {
  manualStatedDetailsSchema,
  normalizedOpportunitySchema,
  parseGeographyList,
  residencyRequirementFor,
  type FieldProvenanceInput,
  type ManualStatedDetails,
  type NormalizedOpportunity,
  type OpportunityNormalizer,
  type RawOpportunity,
} from "@ai-career/core";
import { bareDollarCurrencySourceField, parseCompensation } from "./compensation";
import { parseResidency, residencySourceFields } from "./residency";
import {
  seniorityFromTitle,
  standardizeEmploymentType,
  workArrangementFromLocation,
} from "./position";

export { bareDollarCurrencySourceField, parseCompensation, type ParsedCompensation } from "./compensation";
export { seniorityFromTitle, standardizeEmploymentType, workArrangementFromLocation } from "./position";
export { decodeHtmlEntities, htmlToText } from "./html-text";
export { createRetrievedOpportunityNormalizer } from "./retrieved";
export { parseResidency, residencySourceFields, type ParsedResidency, type ResidencyStatement } from "./residency";

function normalizeOptionalText(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseExplicitDate(value: string | null, label = "posting date"): Date | null {
  if (value === null) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Manual ${label} must use YYYY-MM-DD format`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Manual ${label} is invalid`);
  }

  return parsed;
}

// Details the user stated explicitly on the manual form. Records captured
// before these fields existed have none.
function statedDetails(rawOpportunity: RawOpportunity): ManualStatedDetails {
  const details = rawOpportunity.sourceMetadata?.details;
  const parsed = manualStatedDetailsSchema.safeParse(details ?? undefined);
  if (!parsed.success) {
    throw new Error("Manual stated details are invalid");
  }
  return parsed.data;
}

function provenanceFor(input: {
  fieldName: string;
  sourceField: string;
  sourceValue: string;
  normalizedValue: string;
  collectedAt: Date;
}): FieldProvenanceInput {
  return {
    fieldName: input.fieldName,
    sourceField: input.sourceField,
    kind:
      input.sourceValue === input.normalizedValue ? "DIRECT" : "DETERMINISTIC",
    normalizedValue: input.normalizedValue,
    sourceReference: "manual-submission",
    sourceText: input.sourceValue,
    collectedAt: input.collectedAt,
  };
}

export function createManualOpportunityNormalizer(): OpportunityNormalizer {
  return {
    async normalize(rawOpportunity: RawOpportunity) {
      if (rawOpportunity.sourceType !== "MANUAL") {
        throw new Error("The manual normalizer only accepts MANUAL source records");
      }

      if (rawOpportunity.description === null) {
        throw new Error("Manual source records require raw opportunity text");
      }

      const title = normalizeOptionalText(rawOpportunity.title);
      const companyName = normalizeOptionalText(rawOpportunity.company);
      const location = normalizeOptionalText(rawOpportunity.location);
      const salaryText = normalizeOptionalText(rawOpportunity.salaryText);
      const domain = normalizeOptionalText(rawOpportunity.domain);
      const postingDate = parseExplicitDate(rawOpportunity.postingDate);
      const details = statedDetails(rawOpportunity);
      const closingDate = parseExplicitDate(details.closingDate, "closing date");
      const department = normalizeOptionalText(details.department);
      // Only as the user stated it; the job text is never scanned for it.
      const timeZoneRequirements = normalizeOptionalText(details.timeZoneRequirements);
      const employmentType = standardizeEmploymentType(
        normalizeOptionalText(rawOpportunity.employmentType),
      );
      // A stated choice takes precedence over a value read from another
      // field; a value is read from location or title only when explicit.
      const locationArrangement = workArrangementFromLocation(location);
      const remoteStatus = details.workArrangement ?? locationArrangement;
      const titleSeniority = seniorityFromTitle(title);
      const seniority = details.seniority ?? titleSeniority;
      const compensation = parseCompensation(salaryText, details.compensationCurrency);
      // Residency: what the user stated wins; otherwise only explicit
      // statements in the location field or the job text (never currency,
      // a bare "Remote", a city/country on its own, or nationality).
      const statedRegions = details.residencyRegions === null ? null : parseGeographyList(details.residencyRegions);
      if (details.residencyRegions !== null && statedRegions === null) {
        throw new Error("Manual stated details are invalid");
      }
      const stated = details.residencyRequirement !== null || statedRegions !== null;
      const parsedResidency = stated
        ? null
        : parseResidency({ location, rawText: rawOpportunity.description });
      const residencyRegions = stated
        ? statedRegions ?? (details.residencyRequirement === "US_REQUIRED" ? ["US"] : [])
        : parsedResidency!.regions;
      const residencyRequirement = stated
        ? details.residencyRequirement ?? residencyRequirementFor(statedRegions!)
        : parsedResidency!.requirement;
      if (stated && details.residencyRequirement && statedRegions &&
        residencyRequirementFor(statedRegions) !== details.residencyRequirement) {
        throw new Error("Manual stated details are invalid");
      }

      const opportunity: NormalizedOpportunity = normalizedOpportunitySchema.parse({
        domain,
        externalListingId: rawOpportunity.externalId,
        atsRequisitionId: rawOpportunity.requisitionId,
        canonicalUrl: rawOpportunity.sourceUrl,
        applicationUrl: rawOpportunity.applicationUrl,
        originalSource: rawOpportunity.source,
        discoveredAt: rawOpportunity.discoveredAt,
        sourceUpdatedAt: null,
        firstSeenAt: rawOpportunity.discoveredAt,
        lastSeenAt: rawOpportunity.discoveredAt,
        companyName,
        brand: null,
        parentCompany: null,
        industry: null,
        headquarters: null,
        companySize: null,
        title,
        department,
        employmentType,
        seniority,
        location,
        remoteStatus,
        timeZoneRequirements,
        residencyRequirement,
        residencyRegions,
        salaryMin: compensation.minimum,
        salaryMax: compensation.maximum,
        salaryText,
        bonus: null,
        equity: null,
        currency: compensation.currency,
        compensationNotes: null,
        postingDate,
        closingDate,
        source: rawOpportunity.source,
        sourceType: rawOpportunity.sourceType,
        atsPlatform: null,
        jobDescription: rawOpportunity.description,
        responsibilities: null,
        requirements: null,
        benefits: null,
        additionalNotes: null,
        status: "DISCOVERED",
      });

      const provenance: FieldProvenanceInput[] = [
        provenanceFor({
          fieldName: "jobDescription",
          sourceField: "rawText",
          sourceValue: rawOpportunity.description,
          normalizedValue: rawOpportunity.description,
          collectedAt: rawOpportunity.discoveredAt,
        }),
      ];

      const suppliedTextFields = [
        ["title", "title", rawOpportunity.title, title],
        ["company.name", "company", rawOpportunity.company, companyName],
        ["location", "location", rawOpportunity.location, location],
        [
          "salaryText",
          "compensationText",
          rawOpportunity.salaryText,
          salaryText,
        ],
        ["domain", "domain", rawOpportunity.domain, domain],
      ] as const;

      for (const [fieldName, sourceField, sourceValue, normalizedValue] of suppliedTextFields) {
        if (sourceValue !== null && normalizedValue !== null) {
          provenance.push(
            provenanceFor({
              fieldName,
              sourceField,
              sourceValue,
              normalizedValue,
              collectedAt: rawOpportunity.discoveredAt,
            }),
          );
        }
      }

      const suppliedUrlFields = [
        ["canonicalUrl", "sourceUrl", rawOpportunity.sourceUrl],
        ["applicationUrl", "applicationUrl", rawOpportunity.applicationUrl],
      ] as const;

      for (const [fieldName, sourceField, value] of suppliedUrlFields) {
        if (value !== null) {
          provenance.push(
            provenanceFor({
              fieldName,
              sourceField,
              sourceValue: value,
              normalizedValue: value,
              collectedAt: rawOpportunity.discoveredAt,
            }),
          );
        }
      }

      if (rawOpportunity.externalId !== null) {
        provenance.push(
          provenanceFor({
            fieldName: "externalListingId",
            sourceField: "sourceJobId",
            sourceValue: rawOpportunity.externalId,
            normalizedValue: rawOpportunity.externalId,
            collectedAt: rawOpportunity.discoveredAt,
          }),
        );
      }

      if (rawOpportunity.postingDate !== null && postingDate !== null) {
        provenance.push({
          fieldName: "postingDate",
          sourceField: "postingDate",
          kind: "DETERMINISTIC",
          normalizedValue: postingDate.toISOString(),
          sourceReference: "manual-submission",
          sourceText: rawOpportunity.postingDate,
          collectedAt: rawOpportunity.discoveredAt,
        });
      }

      const derived = (
        fieldName: string,
        sourceField: string,
        kind: FieldProvenanceInput["kind"],
        normalizedValue: string | number,
        sourceText: string,
      ) =>
        provenance.push({
          fieldName,
          sourceField,
          kind,
          normalizedValue,
          sourceReference: "manual-submission",
          sourceText,
          collectedAt: rawOpportunity.discoveredAt,
        });

      if (closingDate !== null && details.closingDate !== null) {
        derived("closingDate", "closingDate", "DETERMINISTIC", closingDate.toISOString(), details.closingDate);
      }
      if (department !== null && details.department !== null) {
        provenance.push(
          provenanceFor({
            fieldName: "department",
            sourceField: "department",
            sourceValue: details.department,
            normalizedValue: department,
            collectedAt: rawOpportunity.discoveredAt,
          }),
        );
      }
      if (timeZoneRequirements !== null && details.timeZoneRequirements !== null) {
        provenance.push(
          provenanceFor({
            fieldName: "timeZoneRequirements",
            sourceField: "timeZoneRequirements",
            sourceValue: details.timeZoneRequirements,
            normalizedValue: timeZoneRequirements,
            collectedAt: rawOpportunity.discoveredAt,
          }),
        );
      }
      if (employmentType !== null && rawOpportunity.employmentType !== null) {
        derived(
          "employmentType",
          "employmentType",
          rawOpportunity.employmentType === employmentType ? "DIRECT" : "DETERMINISTIC",
          employmentType,
          rawOpportunity.employmentType,
        );
      }
      if (details.workArrangement !== null) {
        derived("remoteStatus", "workArrangement", "DIRECT", details.workArrangement, details.workArrangement);
      } else if (locationArrangement !== null && location !== null) {
        derived("remoteStatus", "location", "DETERMINISTIC", locationArrangement, location);
      }
      if (details.seniority !== null) {
        derived("seniority", "seniority", "DIRECT", details.seniority, details.seniority);
      } else if (titleSeniority !== null && title !== null) {
        derived("seniority", "title", "DETERMINISTIC", titleSeniority, title);
      }
      if (salaryText !== null) {
        if (compensation.minimum !== null) {
          derived("salaryMin", "compensationText", "DETERMINISTIC", compensation.minimum, salaryText);
        }
        if (compensation.maximum !== null) {
          derived("salaryMax", "compensationText", "DETERMINISTIC", compensation.maximum, salaryText);
        }
      }
      if (stated) {
        if (details.residencyRequirement !== null) {
          derived("residencyRequirement", "residencyRequirement", "DIRECT", details.residencyRequirement, details.residencyRequirement);
        } else if (residencyRequirement !== null) {
          derived("residencyRequirement", "residencyRegions", "DETERMINISTIC", residencyRequirement, details.residencyRegions!);
        }
        if (residencyRegions.length) {
          provenance.push({
            fieldName: "residencyRegions",
            sourceField: statedRegions ? "residencyRegions" : "residencyRequirement",
            kind: "DETERMINISTIC",
            normalizedValue: residencyRegions,
            sourceReference: "manual-submission",
            sourceText: details.residencyRegions ?? details.residencyRequirement,
            collectedAt: rawOpportunity.discoveredAt,
          });
        }
      } else if (residencyRequirement !== null) {
        // One pair of rows per explicit statement, with a source marker.
        for (const statement of parsedResidency!.statements) {
          const sourceField = residencySourceFields[statement.source];
          derived("residencyRequirement", sourceField, "DETERMINISTIC", residencyRequirement, statement.sentence);
          provenance.push({
            fieldName: "residencyRegions",
            sourceField,
            kind: "DETERMINISTIC",
            normalizedValue: statement.regions,
            sourceReference: "manual-submission",
            sourceText: statement.sentence,
            collectedAt: rawOpportunity.discoveredAt,
          });
        }
      }
      if (compensation.currency !== null) {
        if (compensation.currencyBasis === "SELECTED") {
          derived("currency", "compensationCurrency", "DIRECT", compensation.currency, compensation.currency);
        } else if (salaryText !== null) {
          // Derived, never direct: an explicit code or symbol in the text, or
          // the bare-"$" rule, which is marked separately.
          derived(
            "currency",
            compensation.currencyBasis === "BARE_DOLLAR_AS_USD" ? bareDollarCurrencySourceField : "compensationText",
            "DETERMINISTIC",
            compensation.currency,
            salaryText,
          );
        }
      }

      return { opportunity, provenance };
    },
  };
}
