import {
  applicationUrlProvenance,
  compensationCurrencyCodes,
  normalizedOpportunitySchema,
  retrievedSourceFactsSchema,
  retrievedStructuredFieldsSchema,
  scanGeography,
  type CompensationCurrency,
  type CompensationTier,
  type FieldProvenanceInput,
  type NormalizedOpportunity,
  type OpportunityNormalizer,
  type RawOpportunity,
  type RetrievedStructuredFields,
} from "@ai-career/core";
import { bareDollarCurrencySourceField, parseCompensation } from "./compensation";
import { onTargetStatementFor, readJobTextFacts, relativePostedDate, standardizeSeniorityLabel, statedCompensationTiers, type TextFact } from "./job-text-facts";
import { parseResidency, residencySourceFields } from "./residency";
import { seniorityFromTitle, standardizeEmploymentType, workArrangementFromLocation } from "./position";

// Normalization of listings produced by automated retrieval and the browser
// extension (Core TDD §11, §51). Facts the source states in structured
// fields get DIRECT provenance (sourceField "source.<field>"); a field the
// user corrected before saving is DIRECT and marked "userCorrected:<field>";
// facts read from text get DETERMINISTIC provenance with the text they came
// from. Precedence for each fact: the user's correction, the source's
// structured value, a deterministic reading of a dedicated field (title,
// location, salary text), the page title (company only), then the job-text
// fallback; a later step only fills a fact still missing, and what none of
// them states stays Unknown. Residency comes only from explicit statements,
// and a time zone is never inferred from a place.

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

function sourceFactsOf(rawOpportunity: RawOpportunity) {
  const parsed = retrievedSourceFactsSchema.safeParse(rawOpportunity.sourceMetadata?.sourceFacts ?? {});
  if (!parsed.success) throw new Error("Retrieved source facts are invalid");
  return parsed.data;
}

// Whether structured fields state annual pay in a recognized currency (they
// then win over any salary text).
export function structuredCompensationApplies(structured: RetrievedStructuredFields): boolean {
  return structured.salaryPeriod === "YEAR" && knownCurrency(structured.salaryCurrency) !== null &&
    (structured.salaryMin !== null || structured.salaryMax !== null) &&
    (structured.salaryMin === null || structured.salaryMax === null || structured.salaryMin <= structured.salaryMax);
}

function structuredFields(rawOpportunity: RawOpportunity) {
  const parsed = retrievedStructuredFieldsSchema.safeParse(rawOpportunity.sourceMetadata?.structured ?? {});
  if (!parsed.success) throw new Error("Retrieved structured fields are invalid");
  return parsed.data;
}

// Neutral context a source may supply with a listing: the page's title, the
// job's bounded page content around its structured description, and the
// fields the user corrected before saving (browser extension).
function metadataText(rawOpportunity: RawOpportunity, key: "pageTitle" | "pageText"): string | null {
  const value = rawOpportunity.sourceMetadata?.[key];
  return typeof value === "string" ? text(value) : null;
}

function userCorrectedFields(rawOpportunity: RawOpportunity): Set<string> {
  const value = rawOpportunity.sourceMetadata?.userCorrectedFields;
  return new Set(Array.isArray(value) ? value.filter((field): field is string => typeof field === "string") : []);
}

const annualPeriod = /\b(?:per\s+(?:year|annum)|a\s+year|annual(?:ly)?|annuali[sz]ed|yearly|p\.a\.?)(?![a-z])|\/\s*(?:yr|year)\b/i;

// "Anywhere", "Worldwide": a remote-hiring place a page may state by
// default. It is used only when nothing else says where the role is; a
// specific location the posting states is never replaced by it.
const worldwidePlaceholder = /^(?:anywhere(?:\s+in\s+the\s+world)?|worldwide|world\s*wide|global(?:ly)?|earth|international|remote)$/i;

// One pay tier: its label, amounts and currency, as its own statement
// states them.
export function compensationTier(tier: { label: string; statement: string }): CompensationTier {
  const parsed = parseCompensation(tier.statement);
  return { label: tier.label, minimum: parsed.minimum, maximum: parsed.maximum, currency: parsed.currency };
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
      const sourceFacts = sourceFactsOf(rawOpportunity);
      const provenance: FieldProvenanceInput[] = [];
      const record = (
        fieldName: string,
        sourceField: string,
        kind: FieldProvenanceInput["kind"],
        normalizedValue: FieldProvenanceInput["normalizedValue"],
        sourceText: string | null,
      ) => provenance.push({ fieldName, sourceField, kind, normalizedValue, sourceReference, sourceText, collectedAt });

      const title = text(rawOpportunity.title)!;
      const corrected = userCorrectedFields(rawOpportunity);
      const facts = readJobTextFacts({
        text: rawOpportunity.description,
        observedAt: rawOpportunity.discoveredAt,
        title,
        pageTitle: metadataText(rawOpportunity, "pageTitle"),
        pageText: metadataText(rawOpportunity, "pageText"),
        location: text(rawOpportunity.location),
        remoteLocations: corrected.has("location") ? [] : sourceFacts.remoteLocations,
        company: text(rawOpportunity.company),
      });
      // A fact read from the text, recorded with its marker; used only when
      // the source supplied nothing for it (and the user did not clear it).
      const fallback = <T extends FieldProvenanceInput["normalizedValue"] | Date>(
        fieldName: string,
        fact: TextFact<T> | null,
        normalizedValue: (value: T) => FieldProvenanceInput["normalizedValue"] = (value) => value as FieldProvenanceInput["normalizedValue"],
      ): T | null => {
        if (!fact) return null;
        record(fieldName, fact.sourceField, "DETERMINISTIC", normalizedValue(fact.value), fact.sourceText);
        return fact.value;
      };
      const sourceCompany = text(rawOpportunity.company);
      // A remote role's remote-hiring geography, as the source states it,
      // is the role's location ("Remote (United States)"); an office the
      // source also names is not. A location the user corrected stays theirs.
      // A worldwide placeholder ("Anywhere") counts only when no specific
      // location is stated by the source or the posting.
      const statedRemoteLocations = corrected.has("location") ? [] : sourceFacts.remoteLocations;
      const placeholderOnly = statedRemoteLocations.length > 0 && statedRemoteLocations.every((place) => worldwidePlaceholder.test(place.trim()));
      const specificLocation = (text(rawOpportunity.location) && scanGeography(rawOpportunity.location!).codes.length > 0) || facts.location !== null;
      const remoteLocations = placeholderOnly && specificLocation ? [] : statedRemoteLocations;
      const remoteLocation = remoteLocations.length ? `Remote (${remoteLocations.join(", ")})` : null;
      // The posting's own labelled location may state the source's location
      // (or its remote-hiring places) together with more places, or more
      // precisely ("United States (East Coast)"): a fuller, not a different,
      // statement, used instead.
      const broaderLocation = corrected.has("location") ? null : remoteLocation ? facts.broaderRemoteLocation : facts.broaderLocation;
      const sourceLocation = broaderLocation ? null : remoteLocation ?? text(rawOpportunity.location);
      const domain = text(rawOpportunity.domain);

      // The description is kept exactly as the source produced it (text
      // converted from the source's HTML, which stays on the source record).
      record("jobDescription", corrected.has("description") ? "userCorrected:description" : "description", "DIRECT", rawOpportunity.description, null);
      record("title", corrected.has("title") ? "userCorrected:title" : "title", title === rawOpportunity.title ? "DIRECT" : "DETERMINISTIC", title, rawOpportunity.title);
      // Boards whose API returns no employer name (Lever, Ashby) take it from
      // the source configuration the user entered; provenance says so.
      const companyField = corrected.has("company")
        ? "userCorrected:company"
        : rawOpportunity.sourceMetadata?.companySource === "configured" ? "sourceConfiguration.company" : "company";
      if (sourceCompany) record("company.name", companyField, sourceCompany === rawOpportunity.company ? "DIRECT" : "DETERMINISTIC", sourceCompany, rawOpportunity.company);
      // A field the user cleared stays Unknown: the fallback never refills it.
      const companyName = sourceCompany ?? (corrected.has("company") ? null : fallback("company.name", facts.companyName));
      if (remoteLocation && sourceLocation) {
        record("location", "source.remoteLocations", "DETERMINISTIC", remoteLocation, remoteLocations.join("; "));
      } else if (sourceLocation) {
        record("location", corrected.has("location") ? "userCorrected:location" : "location", sourceLocation === rawOpportunity.location ? "DIRECT" : "DETERMINISTIC", sourceLocation, rawOpportunity.location);
      }
      const location = sourceLocation ?? (broaderLocation ? fallback("location", broaderLocation) : corrected.has("location") ? null : fallback("location", facts.location));
      // A posting date the source states; a posted age it states ("2 weeks
      // ago") is dated from when the listing was observed, marked as such.
      const statedPostingDate = sourceDate(rawOpportunity.postingDate);
      const postedAge = statedPostingDate ? null : relativePostedDate(rawOpportunity.postingDate, rawOpportunity.discoveredAt);
      const sourcePostingDate = statedPostingDate ?? postedAge;
      if (domain) record("domain", "domain", "DIRECT", domain, rawOpportunity.domain);
      if (rawOpportunity.sourceUrl) record("canonicalUrl", "sourceUrl", "DIRECT", rawOpportunity.sourceUrl, rawOpportunity.sourceUrl);
      if (rawOpportunity.applicationUrl) {
        const basis = applicationUrlProvenance(sourceFacts.applicationUrlBasis);
        record("applicationUrl", basis.sourceField, basis.kind, rawOpportunity.applicationUrl, rawOpportunity.applicationUrl);
      }
      if (rawOpportunity.externalId) record("externalListingId", "externalId", "DIRECT", rawOpportunity.externalId, rawOpportunity.externalId);
      if (rawOpportunity.requisitionId) record("atsRequisitionId", "requisitionId", "DIRECT", rawOpportunity.requisitionId, rawOpportunity.requisitionId);
      const atsRequisitionId = rawOpportunity.requisitionId ?? fallback("atsRequisitionId", facts.requisitionId);
      if (sourcePostingDate && rawOpportunity.postingDate) {
        record("postingDate", postedAge ? "postingDate:relative-posted-age" : "postingDate", "DETERMINISTIC", sourcePostingDate.toISOString(), rawOpportunity.postingDate);
      }
      const postingDate = sourcePostingDate ?? fallback("postingDate", facts.postingDate, (date) => date.toISOString());
      // Closing date: the source's own field (an application deadline), else
      // the job text.
      const sourceClosingDate = sourceDate(sourceFacts.closingDate);
      if (sourceClosingDate) record("closingDate", "source.closingDate", "DETERMINISTIC", sourceClosingDate.toISOString(), sourceFacts.closingDate);
      const closingDate = sourceClosingDate ?? fallback("closingDate", facts.closingDate, (date) => date.toISOString());

      // Work arrangement: the source's own workplace field, else an explicit
      // word in the source's location (as the source stated it, also when a
      // fuller labelled location is shown), else the job text. When the
      // posting offers several arrangements as options and the source's own
      // value is one of them ("Work Style – WFH or come to the office" on a
      // remote listing), the options are kept as stated.
      const statedLocation = remoteLocation ?? text(rawOpportunity.location);
      const locationArrangement = workArrangementFromLocation(statedLocation);
      const sourceArrangement = structured.workplaceType ?? locationArrangement;
      const optionsInclude = facts.workArrangements !== null && sourceArrangement !== null && facts.workArrangements.value.includes(sourceArrangement);
      if (optionsInclude) {
        // (Recorded with the options below.)
      } else if (structured.workplaceType) {
        record("remoteStatus", "source.workplaceType", "DIRECT", structured.workplaceType, structured.workplaceType);
      } else if (locationArrangement && statedLocation) {
        record("remoteStatus", remoteLocation ? "source.remoteLocations" : "location", "DETERMINISTIC", locationArrangement, statedLocation);
      }
      const remoteStatus = optionsInclude ? null : sourceArrangement ?? fallback("remoteStatus", facts.remoteStatus);
      // Several arrangements the posting offers as options, kept as stated
      // when the source names no single one.
      const offeredArrangements = remoteStatus ? null : fallback("workArrangements", facts.workArrangements);
      const workArrangements = remoteStatus ? [remoteStatus] : offeredArrangements ?? [];

      const employmentSource = structured.employmentType ?? text(rawOpportunity.employmentType);
      const sourceEmploymentType = standardizeEmploymentType(employmentSource);
      if (sourceEmploymentType && employmentSource) {
        record(
          "employmentType",
          structured.employmentType ? "source.employmentType" : "employmentType",
          employmentSource === sourceEmploymentType ? "DIRECT" : "DETERMINISTIC",
          sourceEmploymentType,
          employmentSource,
        );
      }
      // A stated but unrecognized value ("Full-time, Contract") stays Unknown
      // rather than being replaced by the text.
      const employmentType = sourceEmploymentType ?? (employmentSource ? null : fallback("employmentType", facts.employmentType));

      // Seniority: a level the source states and the title's own level word
      // are both explicit; when both are read and disagree, or the source
      // states two different levels, it is Unknown. A label outside the
      // vocabulary ("Mid-Senior level") states no level.
      const statedLevels = [...new Set(sourceFacts.seniority.map(standardizeSeniorityLabel).filter((level) => level !== null))];
      const sourceSeniority = statedLevels.length === 1 ? statedLevels[0]! : null;
      const titleSeniority = seniorityFromTitle(title);
      const seniorityConflict = statedLevels.length > 1 || (sourceSeniority !== null && titleSeniority !== null && sourceSeniority !== titleSeniority);
      let seniority: NormalizedOpportunity["seniority"] = null;
      if (!seniorityConflict) {
        if (sourceSeniority) {
          const label = sourceFacts.seniority.find((value) => standardizeSeniorityLabel(value) === sourceSeniority)!;
          record("seniority", "source.seniority", label === sourceSeniority ? "DIRECT" : "DETERMINISTIC", sourceSeniority, label);
        }
        if (titleSeniority) record("seniority", "title", "DETERMINISTIC", titleSeniority, title);
        seniority = sourceSeniority ?? titleSeniority ?? (statedLevels.length ? null : fallback("seniority", facts.seniority));
      }
      // The stated label, kept as stated whether or not it names one level.
      const statedLabel = sourceFacts.seniority.length === 1 ? sourceFacts.seniority[0]! : null;
      if (statedLabel) record("seniorityLabel", "source.seniority", "DIRECT", statedLabel, statedLabel);
      const seniorityLabel = statedLabel ?? (sourceFacts.seniority.length ? null : fallback("seniorityLabel", facts.seniorityLabel));
      // Department: as the source names it, else a labelled line.
      if (sourceFacts.department) record("department", "source.department", "DIRECT", sourceFacts.department, sourceFacts.department);
      const department = sourceFacts.department ?? fallback("department", facts.department);
      const timeZoneRequirements = fallback("timeZoneRequirements", facts.timeZoneRequirements);

      // Work authorization, sponsorship, relocation and employer of record:
      // explicit statements only, for any country, and never residency.
      const workAuthorization = facts.workAuthorization;
      if (workAuthorization) {
        record("workAuthorizationRequirement", workAuthorization.sourceField, "DETERMINISTIC", workAuthorization.value.requirement, workAuthorization.sourceText);
        record("workAuthorizationRegions", workAuthorization.sourceField, "DETERMINISTIC", workAuthorization.value.regions, workAuthorization.sourceText);
      }
      const visaSponsorship = fallback("visaSponsorship", facts.visaSponsorship);
      const relocationSupport = fallback("relocationSupport", facts.relocationSupport);
      const employerOfRecordRegions = fallback("employerOfRecordRegions", facts.employerOfRecord) ?? [];

      // Residency: explicit statements in the location or description only
      // (a remote role's location that is only geography counts as one).
      // (A remote role's stated hiring places count even when the posting's
      // fuller labelled location is shown.)
      const residency = parseResidency({ location: remoteLocation ?? location, rawText: rawOpportunity.description, remote: remoteStatus === "REMOTE" || sourceArrangement === "REMOTE" });
      if (residency.requirement !== null) {
        for (const statement of residency.statements) {
          const sourceField = residencySourceFields[statement.source];
          record("residencyRequirement", sourceField, "DETERMINISTIC", residency.requirement, statement.sentence);
          record("residencyRegions", sourceField, "DETERMINISTIC", statement.regions, statement.sentence);
        }
      }

      // Compensation: stated annual amounts and a recognized currency from
      // structured fields; otherwise the salary text, or else the job text's
      // compensation statement, is parsed as for manual capture.
      const structuredCurrency = knownCurrency(structured.salaryCurrency);
      const structuredAmounts = structuredCompensationApplies(structured);
      let salaryMin: number | null = null;
      let salaryMax: number | null = null;
      let currency: CompensationCurrency | null = null;
      let compensationBasis: NormalizedOpportunity["compensationBasis"] = null;
      let basisEvidence: { sourceField: string; sourceText: string } | null = null;
      if (structuredAmounts) {
        salaryMin = structured.salaryMin;
        salaryMax = structured.salaryMax;
        currency = structuredCurrency;
        if (salaryMin !== null) record("salaryMin", "source.salaryMin", "DIRECT", salaryMin, String(salaryMin));
        if (salaryMax !== null) record("salaryMax", "source.salaryMax", "DIRECT", salaryMax, String(salaryMax));
        record("currency", "source.salaryCurrency", "DIRECT", structuredCurrency, structured.salaryCurrency);
      }
      // Salary text: the source's salary field, else a dedicated compensation
      // text the source states, else the job text's compensation statement.
      const sourceSalaryText = text(rawOpportunity.salaryText);
      const salaryField = sourceSalaryText ? "salaryText" : sourceFacts.compensationText ? "source.compensation" : null;
      const statedSalaryText = sourceSalaryText ?? sourceFacts.compensationText;
      if (statedSalaryText) {
        const original = sourceSalaryText ? rawOpportunity.salaryText : sourceFacts.compensationText;
        record("salaryText", salaryField!, statedSalaryText === original ? "DIRECT" : "DETERMINISTIC", statedSalaryText, original);
      }
      const salaryText = statedSalaryText ?? (structuredAmounts ? null : fallback("salaryText", facts.compensation));
      // Structured amounts state no basis; the source's own salary text may,
      // when it states the same range.
      if (structuredAmounts && statedSalaryText) {
        const stated = parseCompensation(statedSalaryText);
        if (stated.basis && stated.minimum === salaryMin && stated.maximum === salaryMax) {
          compensationBasis = stated.basis;
          basisEvidence = { sourceField: salaryField!, sourceText: statedSalaryText };
        }
      }
      // A source compensation text states no pay period: its amounts count
      // only when the text itself says they are annual.
      const periodUnstated = salaryField === "source.compensation" && !annualPeriod.test(salaryText ?? "");
      if (!structuredAmounts && salaryText && !periodUnstated) {
        const amountsField = salaryField ?? facts.compensation!.sourceField;
        const parsed = parseCompensation(salaryText);
        salaryMin = parsed.minimum;
        salaryMax = parsed.maximum;
        currency = parsed.currency;
        compensationBasis = parsed.basis;
        if (compensationBasis !== null) basisEvidence = { sourceField: amountsField, sourceText: salaryText };
        if (salaryMin !== null) record("salaryMin", amountsField, "DETERMINISTIC", salaryMin, salaryText);
        if (salaryMax !== null) record("salaryMax", amountsField, "DETERMINISTIC", salaryMax, salaryText);
        if (currency !== null) {
          record(
            "currency",
            parsed.currencyBasis === "BARE_DOLLAR_AS_USD" ? bareDollarCurrencySourceField : amountsField,
            "DETERMINISTIC",
            currency,
            salaryText,
          );
        }
      }
      // The description may call the same range on-target earnings: OTE
      // takes precedence over a basis the source left open or gave as base.
      const onTarget = compensationBasis === "OTE" ? null : onTargetStatementFor(rawOpportunity.description, { minimum: salaryMin, maximum: salaryMax, currency });
      if (onTarget) {
        compensationBasis = onTarget.value;
        basisEvidence = onTarget;
      }
      if (compensationBasis !== null && basisEvidence) {
        record("compensationBasis", basisEvidence.sourceField, "DETERMINISTIC", compensationBasis, basisEvidence.sourceText);
      }
      // Pay stated in several regional tiers: no single range is the role's,
      // whatever one source field states; the tiers are the salary text, and
      // their currency is kept only when they share one.
      let tieredSalaryText: string | null = null;
      let compensationTiers: CompensationTier[] = [];
      // (Also a source salary text that itself names each tier's range.)
      const tiers = facts.compensationTiers ?? (statedSalaryText && !structuredAmounts ? statedCompensationTiers(statedSalaryText, salaryField!) : null);
      if (tiers) {
        for (let index = provenance.length - 1; index >= 0; index -= 1) {
          if (["salaryMin", "salaryMax", "currency", "compensationBasis", "salaryText"].includes(provenance[index]!.fieldName)) provenance.splice(index, 1);
        }
        salaryMin = null;
        salaryMax = null;
        compensationBasis = null;
        currency = knownCurrency(tiers.currency);
        tieredSalaryText = tiers.value;
        record("salaryText", tiers.sourceField, "DETERMINISTIC", tiers.value, tiers.sourceText);
        if (currency) record("currency", tiers.sourceField, "DETERMINISTIC", currency, tiers.sourceText);
        compensationTiers = tiers.tiers.map(compensationTier);
        record("compensationTiers", tiers.sourceField, "DETERMINISTIC", compensationTiers, tiers.sourceText);
      }
      // Variable pay the posting states on its own (never the salary range).
      const bonus = fallback("bonus", facts.bonus);

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
        residencyRequirement: residency.requirement,
        residencyRegions: residency.regions,
        workAuthorizationRequirement: workAuthorization?.value.requirement ?? null,
        workAuthorizationRegions: workAuthorization?.value.regions ?? [],
        visaSponsorship,
        relocationSupport,
        employerOfRecordRegions,
        salaryMin,
        salaryMax,
        salaryText: tieredSalaryText ?? salaryText,
        compensationBasis,
        compensationTiers,
        bonus,
        equity: null,
        currency,
        compensationNotes: null,
        postingDate,
        closingDate,
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
