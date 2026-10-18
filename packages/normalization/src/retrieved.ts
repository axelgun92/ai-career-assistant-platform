import {
  compensationCurrencyCodes,
  normalizedOpportunitySchema,
  retrievedStructuredFieldsSchema,
  type CompensationCurrency,
  type FieldProvenanceInput,
  type NormalizedOpportunity,
  type OpportunityNormalizer,
  type RawOpportunity,
} from "@ai-career/core";
import { bareDollarCurrencySourceField, parseCompensation } from "./compensation";
import { parseResidency, residencySourceFields } from "./residency";
import { seniorityFromTitle, standardizeEmploymentType, workArrangementFromLocation } from "./position";

// Normalization of listings produced by automated retrieval (Core TDD §11).
// Facts the source states in structured fields get DIRECT provenance
// (sourceField "source.<field>"); facts read from text get DETERMINISTIC
// provenance with the text they came from. Residency comes only from
// explicit statements, and a time-zone requirement is never inferred.

function text(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Source dates arrive as ISO timestamps or dates; anything else stays
// Unknown rather than failing the listing.
function sourceDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function structuredFields(rawOpportunity: RawOpportunity) {
  const parsed = retrievedStructuredFieldsSchema.safeParse(rawOpportunity.sourceMetadata?.structured ?? {});
  if (!parsed.success) throw new Error("Retrieved structured fields are invalid");
  return parsed.data;
}

function knownCurrency(value: string | null): CompensationCurrency | null {
  const code = value?.trim().toUpperCase() ?? "";
  return (compensationCurrencyCodes as readonly string[]).includes(code) ? (code as CompensationCurrency) : null;
}

export function createRetrievedOpportunityNormalizer(): OpportunityNormalizer {
  return {
    async normalize(rawOpportunity: RawOpportunity) {
      const retrieval = rawOpportunity.retrieval;
      if (!retrieval || rawOpportunity.sourceType === "MANUAL") {
        throw new Error("The retrieved normalizer only accepts listings produced by retrieval");
      }
      if (rawOpportunity.description === null) {
        throw new Error("Retrieved listings require a description");
      }
      if (text(rawOpportunity.title) === null) {
        throw new Error("Retrieved listings require a title");
      }
      const collectedAt = rawOpportunity.discoveredAt;
      const sourceReference = `retrieval:${rawOpportunity.source}`;
      const structured = structuredFields(rawOpportunity);
      const provenance: FieldProvenanceInput[] = [];
      const record = (
        fieldName: string,
        sourceField: string,
        kind: FieldProvenanceInput["kind"],
        normalizedValue: FieldProvenanceInput["normalizedValue"],
        sourceText: string | null,
      ) => provenance.push({ fieldName, sourceField, kind, normalizedValue, sourceReference, sourceText, collectedAt });

      const title = text(rawOpportunity.title)!;
      const companyName = text(rawOpportunity.company);
      const location = text(rawOpportunity.location);
      const salaryText = text(rawOpportunity.salaryText);
      const domain = text(rawOpportunity.domain);
      const postingDate = sourceDate(rawOpportunity.postingDate);

      // The description is kept exactly as the adapter produced it (text
      // converted from the source's HTML, which stays on the source record).
      record("jobDescription", "description", "DIRECT", rawOpportunity.description, null);
      record("title", "title", title === rawOpportunity.title ? "DIRECT" : "DETERMINISTIC", title, rawOpportunity.title);
      // Boards whose API returns no employer name (Lever, Ashby) take it from
      // the source configuration the user entered; provenance says so.
      const companyField = rawOpportunity.sourceMetadata?.companySource === "configured" ? "sourceConfiguration.company" : "company";
      if (companyName) record("company.name", companyField, companyName === rawOpportunity.company ? "DIRECT" : "DETERMINISTIC", companyName, rawOpportunity.company);
      if (location) record("location", "location", location === rawOpportunity.location ? "DIRECT" : "DETERMINISTIC", location, rawOpportunity.location);
      if (salaryText) record("salaryText", "salaryText", salaryText === rawOpportunity.salaryText ? "DIRECT" : "DETERMINISTIC", salaryText, rawOpportunity.salaryText);
      if (domain) record("domain", "domain", "DIRECT", domain, rawOpportunity.domain);
      if (rawOpportunity.sourceUrl) record("canonicalUrl", "sourceUrl", "DIRECT", rawOpportunity.sourceUrl, rawOpportunity.sourceUrl);
      if (rawOpportunity.applicationUrl) record("applicationUrl", "applicationUrl", "DIRECT", rawOpportunity.applicationUrl, rawOpportunity.applicationUrl);
      if (rawOpportunity.externalId) record("externalListingId", "externalId", "DIRECT", rawOpportunity.externalId, rawOpportunity.externalId);
      if (rawOpportunity.requisitionId) record("atsRequisitionId", "requisitionId", "DIRECT", rawOpportunity.requisitionId, rawOpportunity.requisitionId);
      if (postingDate && rawOpportunity.postingDate) {
        record("postingDate", "postingDate", "DETERMINISTIC", postingDate.toISOString(), rawOpportunity.postingDate);
      }

      // Work arrangement: the source's own workplace field, else an explicit
      // word in the location.
      const locationArrangement = workArrangementFromLocation(location);
      const remoteStatus = structured.workplaceType ?? locationArrangement;
      if (structured.workplaceType) {
        record("remoteStatus", "source.workplaceType", "DIRECT", structured.workplaceType, structured.workplaceType);
      } else if (locationArrangement && location) {
        record("remoteStatus", "location", "DETERMINISTIC", locationArrangement, location);
      }

      const employmentSource = structured.employmentType ?? text(rawOpportunity.employmentType);
      const employmentType = standardizeEmploymentType(employmentSource);
      if (employmentType && employmentSource) {
        record(
          "employmentType",
          structured.employmentType ? "source.employmentType" : "employmentType",
          employmentSource === employmentType ? "DIRECT" : "DETERMINISTIC",
          employmentType,
          employmentSource,
        );
      }

      const seniority = seniorityFromTitle(title);
      if (seniority) record("seniority", "title", "DETERMINISTIC", seniority, title);

      // Compensation: stated annual amounts and a recognized currency from
      // structured fields; otherwise the salary text is parsed as for manual
      // capture.
      const structuredCurrency = knownCurrency(structured.salaryCurrency);
      const structuredAmounts =
        structured.salaryPeriod === "YEAR" && structuredCurrency !== null &&
        (structured.salaryMin !== null || structured.salaryMax !== null) &&
        (structured.salaryMin === null || structured.salaryMax === null || structured.salaryMin <= structured.salaryMax);
      let salaryMin: number | null = null;
      let salaryMax: number | null = null;
      let currency: CompensationCurrency | null = null;
      if (structuredAmounts) {
        salaryMin = structured.salaryMin;
        salaryMax = structured.salaryMax;
        currency = structuredCurrency;
        if (salaryMin !== null) record("salaryMin", "source.salaryMin", "DIRECT", salaryMin, String(salaryMin));
        if (salaryMax !== null) record("salaryMax", "source.salaryMax", "DIRECT", salaryMax, String(salaryMax));
        record("currency", "source.salaryCurrency", "DIRECT", structuredCurrency, structured.salaryCurrency);
      } else if (salaryText) {
        const parsed = parseCompensation(salaryText);
        salaryMin = parsed.minimum;
        salaryMax = parsed.maximum;
        currency = parsed.currency;
        if (salaryMin !== null) record("salaryMin", "salaryText", "DETERMINISTIC", salaryMin, salaryText);
        if (salaryMax !== null) record("salaryMax", "salaryText", "DETERMINISTIC", salaryMax, salaryText);
        if (currency !== null) {
          record(
            "currency",
            parsed.currencyBasis === "BARE_DOLLAR_AS_USD" ? bareDollarCurrencySourceField : "salaryText",
            "DETERMINISTIC",
            currency,
            salaryText,
          );
        }
      }

      // Residency: explicit statements in the location or description only.
      const residency = parseResidency({ location, rawText: rawOpportunity.description });
      if (residency.requirement !== null) {
        for (const statement of residency.statements) {
          const sourceField = residencySourceFields[statement.source];
          record("residencyRequirement", sourceField, "DETERMINISTIC", residency.requirement, statement.sentence);
          record("residencyRegions", sourceField, "DETERMINISTIC", statement.regions, statement.sentence);
        }
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
        department: null,
        employmentType,
        seniority,
        location,
        remoteStatus,
        timeZoneRequirements: null,
        residencyRequirement: residency.requirement,
        residencyRegions: residency.regions,
        salaryMin,
        salaryMax,
        salaryText,
        bonus: null,
        equity: null,
        currency,
        compensationNotes: null,
        postingDate,
        closingDate: null,
        source: rawOpportunity.source,
        sourceType: rawOpportunity.sourceType,
        atsPlatform: retrieval.sourceCategory === "ATS" ? rawOpportunity.source : null,
        jobDescription: rawOpportunity.description,
        responsibilities: null,
        requirements: null,
        benefits: null,
        additionalNotes: null,
        status: "DISCOVERED",
      });
      return { opportunity, provenance };
    },
  };
}
