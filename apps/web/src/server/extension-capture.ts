import {
  cleanCapturedText,
  cleanPageUrl,
  extensionCaptureSchema,
  isLinkedInHost,
  linkedInJobIdFromUrl,
  RetrievedListingNormalizationError,
  type ApplicationUrlBasis,
  type DiscoveryConfiguration,
  type ExtensionCapture,
  type RawOpportunity,
  type RetrievalIngestionService,
  type RetrievedListingOutcome,
  type SourceCategory,
} from "@ai-career/core";
import type { ExtensionPairingRecord } from "@ai-career/database";
import { listingUrlKey } from "@ai-career/deduplication";
import { buildRetrievedListing, createTitleMatcher, linkedInJobUrl } from "@ai-career/discovery";
import {
  pageContextEvidence,
  seniorityFromTitle,
  structuredCompensationApplies,
  workArrangementFromLocation,
} from "@ai-career/normalization";
import type { ZodError } from "zod";

// Capture from the browser extension companion (feature 14B). One job page
// the user asked the extension to read becomes a retrieved listing with
// browser-extension provenance and goes through the existing retrieval
// ingestion: normalization, deduplication, re-observation and application
// link precedence, in the same capture transaction as every other source.
// A capture only saves. It never evaluates, queues or reserves budget;
// evaluation stays the user's explicit request through the existing path.

export const extensionSourceKey = "browser-extension";

interface KnownSite {
  key: string;
  name: string;
  category: SourceCategory;
  matches: (host: string) => boolean;
}

const exactly = (...hosts: string[]) => (host: string) => hosts.includes(host);
const within = (domain: string) => (host: string) => host === domain || host.endsWith(`.${domain}`);

// The sites the server recognizes and the category each one's listings
// carry. Category decides application-link precedence (ATS and employer
// links outrank job boards, which outrank aggregators); every other host is
// an aggregator, the lowest precedence, so a capture from an unrecognized
// site never replaces a stronger link.
const knownSites: readonly KnownSite[] = [
  { key: "greenhouse", name: "Greenhouse", category: "ATS", matches: exactly("boards.greenhouse.io", "job-boards.greenhouse.io") },
  { key: "lever", name: "Lever", category: "ATS", matches: exactly("jobs.lever.co") },
  { key: "ashby", name: "Ashby", category: "ATS", matches: exactly("jobs.ashbyhq.com") },
  { key: "workday", name: "Workday", category: "ATS", matches: within("myworkdayjobs.com") },
  { key: "smartrecruiters", name: "SmartRecruiters", category: "ATS", matches: exactly("jobs.smartrecruiters.com") },
  { key: "workable", name: "Workable", category: "ATS", matches: exactly("apply.workable.com") },
  { key: "workable-jobs", name: "Workable Jobs", category: "JOB_BOARD", matches: exactly("jobs.workable.com") },
  { key: "linkedin", name: "LinkedIn", category: "JOB_BOARD", matches: isLinkedInHost },
  { key: "welcome-to-the-jungle", name: "Welcome to the Jungle", category: "JOB_BOARD", matches: within("welcometothejungle.com") },
  { key: "otta", name: "Otta", category: "JOB_BOARD", matches: within("otta.com") },
  { key: "we-work-remotely", name: "We Work Remotely", category: "JOB_BOARD", matches: within("weworkremotely.com") },
  { key: "remote-ok", name: "Remote OK", category: "JOB_BOARD", matches: (host) => within("remoteok.com")(host) || within("remoteok.io")(host) },
  { key: "himalayas", name: "Himalayas", category: "JOB_BOARD", matches: within("himalayas.app") },
  { key: "working-nomads", name: "Working Nomads", category: "JOB_BOARD", matches: within("workingnomads.com") },
  { key: "wellfound", name: "Wellfound", category: "MARKETPLACE", matches: within("wellfound.com") },
  { key: "adzuna", name: "Adzuna", category: "AGGREGATOR", matches: (host) => /(^|\.)adzuna\.[a-z.]+$/.test(host) },
];

export interface CaptureSite {
  host: string;
  key: string;
  name: string;
  category: SourceCategory;
  knownHost: boolean;
}

export function classifyCaptureSite(pageUrl: string): CaptureSite {
  const host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "");
  const known = knownSites.find((site) => site.matches(host));
  if (known) return { host, key: known.key, name: known.name, category: known.category, knownHost: true };
  return { host, key: host, name: host, category: "AGGREGATOR", knownHost: false };
}

export class ExtensionCaptureError extends Error {
  constructor(
    readonly code: "INVALID_CAPTURE" | "UNSUPPORTED_PAGE",
    message: string,
    readonly issues: Array<{ path: string; message: string }> = [],
  ) {
    super(message);
    this.name = "ExtensionCaptureError";
  }
}

export interface CapturedPageIdentity {
  site: CaptureSite;
  // The listing URL stored as the source URL: LinkedIn's canonical job URL,
  // otherwise the page URL without tracking parameters.
  sourceUrl: string;
  // The source listing ID that makes a repeat capture of the same page a
  // re-observation: "<site>:<job ID>" when the site's URL carries one,
  // otherwise "<site>:<URL key>"; null for a page whose URL identifies no
  // listing (a site root).
  externalId: string | null;
  // A job ID read from the URL by a known site rule.
  urlJobId: string | null;
}

// LinkedIn is read only on a job page (D2): any other LinkedIn page is
// refused rather than captured.
export function capturedPageIdentity(pageUrl: string): CapturedPageIdentity {
  const cleaned = cleanPageUrl(pageUrl);
  if (!cleaned) throw new ExtensionCaptureError("UNSUPPORTED_PAGE", "Only http(s) pages can be captured");
  const site = classifyCaptureSite(cleaned);
  if (site.key === "linkedin") {
    const jobId = linkedInJobIdFromUrl(cleaned);
    if (!jobId) throw new ExtensionCaptureError("UNSUPPORTED_PAGE", "Open a LinkedIn job page to capture it");
    return { site, sourceUrl: linkedInJobUrl(jobId), externalId: `${site.key}:${jobId}`, urlJobId: jobId };
  }
  const key = listingUrlKey(cleaned);
  return { site, sourceUrl: cleaned, externalId: key ? `${site.key}:${key}` : null, urlJobId: null };
}

function issuesOf(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

export function parseCapture(body: unknown): ExtensionCapture {
  const parsed = extensionCaptureSchema.safeParse(body);
  if (!parsed.success) throw new ExtensionCaptureError("INVALID_CAPTURE", "The capture is invalid", issuesOf(parsed.error));
  return parsed.data;
}

const cleanOptional = (value: string | null) => {
  if (value === null) return null;
  const cleaned = cleanCapturedText(value);
  return cleaned ? cleaned : null;
};

// The retrieved listing for one capture. Only the fields the extension read
// are used; nothing is inferred, and an application URL is kept only when
// the page stated one.
// Where to apply, from the page's own evidence. When the page holds the
// application form, or its structured data says it is applied to directly,
// the application page is the captured page itself, by its canonical
// address; the page never chooses that URL. An explicit apply link keeps its
// destination (without tracking parameters). Nothing else sets one.
function capturedApplication(
  fields: ExtensionCapture["fields"],
  capturedPageUrl: string,
): { applicationUrl: string | null; applicationUrlBasis: ApplicationUrlBasis | null } {
  if (fields.applicationUrlBasis === "PAGE_APPLICATION_FORM" || fields.applicationUrlBasis === "STRUCTURED_DIRECT_APPLY") {
    return { applicationUrl: capturedPageUrl, applicationUrlBasis: fields.applicationUrlBasis };
  }
  const link = fields.applicationUrl ? cleanPageUrl(fields.applicationUrl) : null;
  return link ? { applicationUrl: link, applicationUrlBasis: "PAGE_APPLY_LINK" } : { applicationUrl: null, applicationUrlBasis: null };
}

export function capturedListing(
  capture: ExtensionCapture,
  context: { pairingId: string; domain: string; receivedAt: Date },
): { raw: RawOpportunity; identity: CapturedPageIdentity } {
  const identity = capturedPageIdentity(capture.pageUrl);
  const fields = capture.fields;
  const title = cleanCapturedText(fields.title);
  const description = cleanCapturedText(fields.description);
  if (!title || !description) {
    throw new ExtensionCaptureError("INVALID_CAPTURE", "The capture needs a title and a description", [
      ...(!title ? [{ path: "fields.title", message: "Must contain visible text" }] : []),
      ...(!description ? [{ path: "fields.description", message: "Must contain visible text" }] : []),
    ]);
  }
  const validated = {
    title,
    description,
    company: cleanOptional(fields.company),
    location: cleanOptional(fields.location),
    salaryText: cleanOptional(fields.salaryText),
    salaryMin: fields.salaryMin,
    salaryMax: fields.salaryMax,
    salaryCurrency: fields.salaryCurrency?.toUpperCase() ?? null,
    salaryPeriod: fields.salaryPeriod,
    workplaceType: fields.workplaceType,
    employmentType: cleanOptional(fields.employmentType),
    postedAt: cleanOptional(fields.postedAt),
    closingDate: cleanOptional(fields.closingDate),
    ...capturedApplication(fields, identity.sourceUrl),
    siteJobId: fields.siteJobId,
    remoteLocations: [...new Set(fields.remoteLocations.map(cleanCapturedText).filter(Boolean))],
    seniority: cleanOptional(fields.seniority),
  };
  const linkedIn = identity.site.key === "linkedin";
  const pageTitle = linkedIn || !capture.pageTitle ? null : cleanOptional(capture.pageTitle);
  const pageText = linkedIn || !capture.pageText ? null : cleanOptional(capture.pageText);
  const structured = {
    salaryMin: validated.salaryMin,
    salaryMax: validated.salaryMax,
    salaryCurrency: validated.salaryCurrency,
    salaryPeriod: validated.salaryPeriod,
    workplaceType: validated.workplaceType,
    employmentType: null,
  };
  // Change detection for the page context: the labelled evidence Core's
  // shared reader takes from it (and the employer the page title names), for
  // the facts the capture does not already supply at a higher precedence;
  // never the raw page text, so layout and widget noise is not a change.
  // Captures with no such evidence keep the content hash they always had.
  const postedAt = validated.postedAt ? new Date(validated.postedAt) : null;
  const evidence = pageContextEvidence(
    { text: validated.description, title: validated.title, pageTitle, pageText, location: validated.location },
    {
      companyName: validated.company !== null || capture.editedFields.includes("company"),
      location: validated.location !== null || capture.editedFields.includes("location"),
      remoteStatus: validated.workplaceType !== null || workArrangementFromLocation(validated.location) !== null,
      employmentType: validated.employmentType !== null,
      compensation: validated.salaryText !== null || structuredCompensationApplies(structured),
      postingDate: postedAt !== null && !Number.isNaN(postedAt.getTime()),
      seniority: seniorityFromTitle(validated.title) !== null || validated.seniority !== null,
    },
  );
  // The page's stated remote-hiring places and seniority label are material:
  // a changed one is a new version. (Captures without them keep the content
  // hash they always had.)
  const statedMaterial = {
    ...(validated.remoteLocations.length ? { remoteLocations: validated.remoteLocations } : {}),
    ...(validated.seniority ? { seniority: validated.seniority } : {}),
  };
  const raw = buildRetrievedListing(
    {
      key: extensionSourceKey,
      name: `${identity.site.name} (browser extension)`,
      attribution: null,
      sourceType: "BROWSER_EXTENSION",
      retrievalType: "BROWSER_ASSISTED",
      sourceCategory: identity.site.category,
    },
    {
      externalId: identity.externalId,
      title: validated.title,
      company: validated.company,
      location: validated.location,
      description: validated.description,
      salaryText: validated.salaryText,
      employmentType: validated.employmentType,
      postingDate: validated.postedAt,
      sourceUrl: identity.sourceUrl,
      applicationUrl: validated.applicationUrl,
      // Stated in the page's structured data, for the shared normalizer; a
      // closing date is also material, so a changed one is a new version.
      sourceFacts: {
        closingDate: validated.closingDate,
        applicationUrlBasis: validated.applicationUrlBasis,
        remoteLocations: validated.remoteLocations,
        seniority: validated.seniority ? [validated.seniority] : [],
      },
      structured: {
        salaryMin: validated.salaryMin,
        salaryMax: validated.salaryMax,
        salaryCurrency: validated.salaryCurrency,
        salaryPeriod: validated.salaryPeriod,
        workplaceType: validated.workplaceType,
      },
      ...(evidence.length || validated.closingDate || Object.keys(statedMaterial).length
        ? {
            material: {
              ...(evidence.length ? { pageContext: evidence } : {}),
              ...(validated.closingDate ? { closingDate: validated.closingDate } : {}),
              ...statedMaterial,
            },
          }
        : {}),
      metadata: {
        // Neutral context for Core's shared normalization: the page's title
        // and the job's bounded page content (never LinkedIn's), and the
        // fields the user corrected, whose values are user-authoritative.
        pageTitle,
        pageText,
        userCorrectedFields: capture.editedFields,
        capture: {
          pairingId: context.pairingId,
          extractor: capture.extractor,
          capturedAt: capture.capturedAt,
          extensionVersion: capture.extensionVersion,
          pageUrl: cleanPageUrl(capture.pageUrl),
          host: identity.site.host,
          site: identity.site.key,
          knownHost: identity.site.knownHost,
          // Identifiers the page stated: kept as captured, not used as the
          // listing's identity (only an ID in a known site's URL is).
          siteJobId: validated.siteJobId,
          notes: capture.notes,
          // Fields the user corrected in the preview before saving.
          editedFields: capture.editedFields,
        },
      },
      sourceItem: validated,
    },
    { domain: context.domain, discoveredAt: context.receivedAt },
  );
  return { raw, identity };
}

export interface EvaluationSummary {
  evaluationId: string;
  status: string;
  queueState: unknown;
  recommendation: { decision: string; explanation: string | null } | null;
  // The latest completed evaluation evaluated an earlier version of the
  // posting than its current one (nothing is reevaluated automatically).
  evaluatedEarlierVersion?: boolean;
}

export interface CaptureResult {
  outcome: RetrievedListingOutcome;
  decision: string | null;
  opportunityId: string;
  sourceRecordId: string;
  opportunityUrl: string;
  site: { host: string; name: string; knownHost: boolean };
  sourceCategory: SourceCategory;
  probableDuplicate: boolean;
  outsideRoleFamilies: boolean;
  evaluation: EvaluationSummary | null;
}

export interface LookupResult {
  found: boolean;
  supported: boolean;
  site: { host: string; name: string; knownHost: boolean } | null;
  opportunityId?: string;
  opportunityUrl?: string;
  title?: string | null;
  company?: string | null;
  evaluation?: EvaluationSummary | null;
}

export interface ExtensionCaptureDependencies {
  ingestion: RetrievalIngestionService;
  lookup: { findCapturedPage(input: { source: string; externalId: string | null; url: string }): Promise<{ opportunityId: string; title: string | null; companyName: string | null } | null> };
  // The persisted evaluation state, read through the existing
  // latest-evaluation path; null when the opportunity has none.
  latestEvaluation(opportunityId: string): Promise<EvaluationSummary | null>;
  discovery: DiscoveryConfiguration;
  now?: () => Date;
}

const opportunityUrl = (id: string) => `/opportunities/${id}`;
const siteView = (site: CaptureSite) => ({ host: site.host, name: site.name, knownHost: site.knownHost });

export function createExtensionCaptureService(dependencies: ExtensionCaptureDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const keepTitle = createTitleMatcher(dependencies.discovery.titleTerms);
  return {
    async capture(body: unknown, pairing: ExtensionPairingRecord): Promise<{ status: 200 | 201; result: CaptureResult }> {
      const capture = parseCapture(body);
      const { raw, identity } = capturedListing(capture, {
        pairingId: pairing.id,
        domain: dependencies.discovery.domain,
        receivedAt: now(),
      });
      let ingested;
      try {
        ingested = await dependencies.ingestion.ingest(raw);
      } catch (error) {
        if (error instanceof RetrievedListingNormalizationError) {
          throw new ExtensionCaptureError("INVALID_CAPTURE", "The captured fields could not be read as a job posting");
        }
        throw error;
      }
      const result: CaptureResult = {
        outcome: ingested.outcome,
        decision: ingested.decision,
        opportunityId: ingested.opportunityId,
        sourceRecordId: ingested.sourceRecordId,
        opportunityUrl: opportunityUrl(ingested.opportunityId),
        site: siteView(identity.site),
        sourceCategory: identity.site.category,
        probableDuplicate: ingested.decision === "PROBABLE_MATCH",
        // Informational only: a capture is kept whatever its title.
        outsideRoleFamilies: !keepTitle(raw.title),
        evaluation: await dependencies.latestEvaluation(ingested.opportunityId),
      };
      return { status: ingested.outcome === "CREATED" ? 201 : 200, result };
    },

    async lookup(url: string | null): Promise<LookupResult> {
      const cleaned = url ? cleanPageUrl(url) : null;
      if (!cleaned) throw new ExtensionCaptureError("UNSUPPORTED_PAGE", "Only http(s) pages can be captured");
      let identity: CapturedPageIdentity;
      try {
        identity = capturedPageIdentity(cleaned);
      } catch (error) {
        if (error instanceof ExtensionCaptureError && error.code === "UNSUPPORTED_PAGE") {
          return { found: false, supported: false, site: siteView(classifyCaptureSite(cleaned)) };
        }
        throw error;
      }
      const match = await dependencies.lookup.findCapturedPage({
        source: extensionSourceKey,
        externalId: identity.externalId,
        url: identity.sourceUrl,
      });
      if (!match) return { found: false, supported: true, site: siteView(identity.site) };
      return {
        found: true,
        supported: true,
        site: siteView(identity.site),
        opportunityId: match.opportunityId,
        opportunityUrl: opportunityUrl(match.opportunityId),
        title: match.title,
        company: match.companyName,
        evaluation: await dependencies.latestEvaluation(match.opportunityId),
      };
    },
  };
}

export type ExtensionCaptureService = ReturnType<typeof createExtensionCaptureService>;
