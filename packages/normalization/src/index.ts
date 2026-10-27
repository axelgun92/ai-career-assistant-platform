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
import { onTargetStatementFor, readJobTextFacts, type TextFact } from "./job-text-facts";
import { parseResidency, residencySourceFields } from "./residency";
import { compensationTier } from "./retrieved";
import {
  seniorityFromTitle,
  standardizeEmploymentType,
  workArrangementFromLocation,
} from "./position";

export {
  bareDollarCurrencySourceField,
  parseCompensation,
  type CompensationGeography,
  type ParsedCompensation,
} from "./compensation";
export {
  jobTextSourceFields,
  onTargetStatementFor,
  pageContextEvidence,
  pageContextSourceFields,
  parseUnambiguousDate,
  readJobTextFacts,
  standardizeSeniorityLabel,
  type EvidenceFact,
  type JobTextFacts,
  type JobTextInput,
  type TextFact,
} from "./job-text-facts";
export { seniorityFromTitle, standardizeEmploymentType, workArrangementFromLocation } from "./position";
export { decodeHtmlEntities, htmlToText, markdownToText } from "./html-text";
export { createRetrievedOpportunityNormalizer, structuredCompensationApplies } from "./retrieved";
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
      const statedCompany = normalizeOptionalText(rawOpportunity.company);
      const statedLocation = normalizeOptionalText(rawOpportunity.location);
      const statedSalaryText = normalizeOptionalText(rawOpportunity.salaryText);
      const domain = normalizeOptionalText(rawOpportunity.domain);
      const statedPostingDate = parseExplicitDate(rawOpportunity.postingDate);
      const details = statedDetails(rawOpportunity);
      const statedClosingDate = parseExplicitDate(details.closingDate, "closing date");
      const statedDepartment = normalizeOptionalText(details.department);
      const statedTimeZone = normalizeOptionalText(details.timeZoneRequirements);
      const statedEmploymentType = normalizeOptionalText(rawOpportunity.employmentType);
      const sourceEmploymentType = standardizeEmploymentType(statedEmploymentType);
      // What the user entered always wins. A fact the form left empty may be
      // filled from the pasted job text, by the same shared reading every
      // source path uses (explicit statements only, marked in provenance);
      // it never replaces a value the user gave.
      const facts = readJobTextFacts({ text: rawOpportunity.description, title, location: statedLocation, company: statedCompany, observedAt: rawOpportunity.discoveredAt });
      const fallbacks: Array<{ fieldName: string; fact: TextFact<unknown>; normalizedValue: FieldProvenanceInput["normalizedValue"] }> = [];
      const fallback = <T>(fieldName: string, fact: TextFact<T> | null, normalizedValue: (value: T) => FieldProvenanceInput["normalizedValue"] = String): T | null => {
        if (!fact) return null;
        fallbacks.push({ fieldName, fact, normalizedValue: normalizedValue(fact.value) });
        return fact.value;
      };
      const isoDate = (date: Date) => date.toISOString();
      const companyName = statedCompany ?? fallback("company.name", facts.companyName);
      const location = statedLocation ?? fallback("location", facts.location);
      const postingDate = statedPostingDate ?? fallback("postingDate", facts.postingDate, isoDate);
      const closingDate = statedClosingDate ?? fallback("closingDate", facts.closingDate, isoDate);
      const department = statedDepartment ?? fallback("department", facts.department);
      const timeZoneRequirements = statedTimeZone ?? fallback("timeZoneRequirements", facts.timeZoneRequirements);
      // Work authorization, sponsorship, relocation and employer of record:
      // explicit statements in the job text only (never residency).
      const workAuthorization = facts.workAuthorization;
      const visaSponsorship = fallback("visaSponsorship", facts.visaSponsorship);
      const relocationSupport = fallback("relocationSupport", facts.relocationSupport);
      const employerOfRecord = facts.employerOfRecord;
      const employmentType = sourceEmploymentType ?? (statedEmploymentType ? null : fallback("employmentType", facts.employmentType));
      // A stated choice takes precedence over a value read from another
      // field; a value is read from location or title only when explicit.
      const locationArrangement = workArrangementFromLocation(statedLocation);
      const remoteStatus = details.workArrangement ?? locationArrangement ??
        fallback("remoteStatus", facts.remoteStatus);
      // Several arrangements the pasted text offers as options, kept as
      // stated when nothing names a single one.
      const offeredArrangements = remoteStatus ? null : fallback("workArrangements", facts.workArrangements, (value) => value);
      const workArrangements = remoteStatus ? [remoteStatus] : offeredArrangements ?? [];
      const titleSeniority = seniorityFromTitle(title);
      const seniority = details.seniority ?? titleSeniority ?? fallback("seniority", facts.seniority);
      // A seniority label the pasted text states, kept as stated (the user's
      // chosen level, when given, is the level).
      const seniorityLabel = details.seniority ? null : fallback("seniorityLabel", facts.seniorityLabel);
      const atsRequisitionId = rawOpportunity.requisitionId ?? fallback("atsRequisitionId", facts.requisitionId);
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
        : parseResidency({ location, rawText: rawOpportunity.description, remote: remoteStatus === "REMOTE" });
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
      // Pay stated in several regional tiers is kept whole as the salary text:
      // read as one statement it names no single range.
      const tiers = statedSalaryText ? null : facts.compensationTiers;
      const textCompensation = tiers ?? facts.compensation;
      const salaryText = statedSalaryText ?? fallback("salaryText", textCompensation);
      const compensationField = statedSalaryText ? "compensationText" : textCompensation?.sourceField ?? "compensationText";
      const geography = { location, residencyRegions, workAuthorizationRegions: workAuthorization?.value.regions ?? [] };
      const compensation = parseCompensation(salaryText, details.compensationCurrency, geography);
      // The labelled tiers, each with its own amounts (no single range).
      const compensationTiers = tiers ? tiers.tiers.map((tier) => compensationTier(tier, geography)) : [];
      if (tiers && compensationTiers.length) fallbacks.push({ fieldName: "compensationTiers", fact: tiers, normalizedValue: compensationTiers });
      const bonus = fallback("bonus", facts.bonus);
      // The job text may call the same range on-target earnings (OTE takes
      // precedence over a basis the salary text left open or gave as base).
      const onTarget = compensation.basis === "OTE" ? null : onTargetStatementFor(rawOpportunity.description, compensation);
      const compensationBasis = onTarget?.value ?? compensation.basis;

      const opportunity: NormalizedOpportunity = normalizedOpportunitySchema.parse({
        domain,
        externalListingId: rawOpportunity.externalId,
        atsRequisitionId,
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
        seniorityLabel,
        workArrangements,
        location,
        remoteStatus,
        timeZoneRequirements,
        residencyRequirement,
        residencyRegions,
        workAuthorizationRequirement: workAuthorization?.value.requirement ?? null,
        workAuthorizationRegions: workAuthorization?.value.regions ?? [],
        visaSponsorship,
        relocationSupport,
        employerOfRecordRegions: employerOfRecord?.value ?? [],
        salaryMin: compensation.minimum,
        salaryMax: compensation.maximum,
        salaryText,
        compensationBasis,
        compensationTiers,
        bonus,
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
        ["company.name", "company", rawOpportunity.company, statedCompany],
        ["location", "location", rawOpportunity.location, statedLocation],
        [
          "salaryText",
          "compensationText",
          rawOpportunity.salaryText,
          statedSalaryText,
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

      if (rawOpportunity.postingDate !== null && statedPostingDate !== null) {
        provenance.push({
          fieldName: "postingDate",
          sourceField: "postingDate",
          kind: "DETERMINISTIC",
          normalizedValue: statedPostingDate.toISOString(),
          sourceReference: "manual-submission",
          sourceText: rawOpportunity.postingDate,
          collectedAt: rawOpportunity.discoveredAt,
        });
      }

      const derived = (
        fieldName: string,
        sourceField: string,
        kind: FieldProvenanceInput["kind"],
        normalizedValue: FieldProvenanceInput["normalizedValue"],
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

      if (statedClosingDate !== null && details.closingDate !== null) {
        derived("closingDate", "closingDate", "DETERMINISTIC", statedClosingDate.toISOString(), details.closingDate);
      }
      if (statedDepartment !== null && details.department !== null) {
        provenance.push(
          provenanceFor({
            fieldName: "department",
            sourceField: "department",
            sourceValue: details.department,
            normalizedValue: statedDepartment,
            collectedAt: rawOpportunity.discoveredAt,
          }),
        );
      }
      if (statedTimeZone !== null && details.timeZoneRequirements !== null) {
        provenance.push(
          provenanceFor({
            fieldName: "timeZoneRequirements",
            sourceField: "timeZoneRequirements",
            sourceValue: details.timeZoneRequirements,
            normalizedValue: statedTimeZone,
            collectedAt: rawOpportunity.discoveredAt,
          }),
        );
      }
      if (sourceEmploymentType !== null && rawOpportunity.employmentType !== null) {
        derived(
          "employmentType",
          "employmentType",
          rawOpportunity.employmentType === sourceEmploymentType ? "DIRECT" : "DETERMINISTIC",
          sourceEmploymentType,
          rawOpportunity.employmentType,
        );
      }
      // Facts read from the job text: DETERMINISTIC, with their marker and
      // the statement they came from.
      for (const { fieldName, fact, normalizedValue } of fallbacks) {
        derived(fieldName, fact.sourceField, "DETERMINISTIC", normalizedValue, fact.sourceText);
      }
      if (details.workArrangement !== null) {
        derived("remoteStatus", "workArrangement", "DIRECT", details.workArrangement, details.workArrangement);
      } else if (locationArrangement !== null && statedLocation !== null) {
        derived("remoteStatus", "location", "DETERMINISTIC", locationArrangement, statedLocation);
      }
      if (details.seniority !== null) {
        derived("seniority", "seniority", "DIRECT", details.seniority, details.seniority);
      } else if (titleSeniority !== null && title !== null) {
        derived("seniority", "title", "DETERMINISTIC", titleSeniority, title);
      }
      if (salaryText !== null) {
        if (compensation.minimum !== null) {
          derived("salaryMin", compensationField, "DETERMINISTIC", compensation.minimum, salaryText);
        }
        if (compensation.maximum !== null) {
          derived("salaryMax", compensationField, "DETERMINISTIC", compensation.maximum, salaryText);
        }
        if (onTarget) {
          derived("compensationBasis", onTarget.sourceField, "DETERMINISTIC", onTarget.value, onTarget.sourceText);
        } else if (compensation.basis !== null) {
          derived("compensationBasis", compensationField, "DETERMINISTIC", compensation.basis, salaryText);
        }
      }
      if (workAuthorization) {
        derived("workAuthorizationRequirement", workAuthorization.sourceField, "DETERMINISTIC", workAuthorization.value.requirement, workAuthorization.sourceText);
        derived("workAuthorizationRegions", workAuthorization.sourceField, "DETERMINISTIC", workAuthorization.value.regions, workAuthorization.sourceText);
      }
      if (employerOfRecord) {
        derived("employerOfRecordRegions", employerOfRecord.sourceField, "DETERMINISTIC", employerOfRecord.value, employerOfRecord.sourceText);
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
            compensation.currencyBasis === "BARE_DOLLAR_AS_USD" ? bareDollarCurrencySourceField : compensationField,
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
