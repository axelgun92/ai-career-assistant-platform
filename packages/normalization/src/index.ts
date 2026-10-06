import {
  normalizedOpportunitySchema,
  type FieldProvenanceInput,
  type NormalizedOpportunity,
  type OpportunityNormalizer,
  type RawOpportunity,
} from "@ai-career/core";

function normalizeOptionalText(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseExplicitDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Manual posting date must use YYYY-MM-DD format");
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Manual posting date is invalid");
  }

  return parsed;
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
        employmentType: normalizeOptionalText(rawOpportunity.employmentType),
        seniority: null,
        location,
        remoteStatus: null,
        timeZoneRequirements: null,
        salaryMin: null,
        salaryMax: null,
        salaryText,
        bonus: null,
        equity: null,
        currency: null,
        compensationNotes: null,
        postingDate,
        closingDate: null,
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

      return { opportunity, provenance };
    },
  };
}
