import { markdownToText } from "@ai-career/normalization";
import { z } from "zod";
import { collectPages, mapKeptItems, parseItems } from "../collection";
import { AdapterError, type SourceAdapter } from "../contract";
import { readJsonScript } from "../embedded-state";
import { getText } from "../transport";
import { isoDate } from "./shared";

// Wellfound (startup marketplace, public HTML). Verified October 18, 2026
// with GET https://wellfound.com/role/customer-success-specialist: the
// logged-out document embeds its listing data in Next.js state
// (<script id="__NEXT_DATA__" type="application/json">), which is parsed
// instead of the visual markup. In props.pageProps.apolloState.data,
// ROOT_QUERY.talent.seoLandingPageJobSearchResults({"page":N,...}) gives
// totalJobCount, perPage (companies per page), pageCount and the page's
// StartupResult references; each StartupResult (the company) lists its
// highlightedJobListings, the JobListingSearchResult entries, which carry
// the complete description (Markdown-style text), title, jobType,
// liveStartAt, locations, remote fields and compensation text. Pages are
// ?page=N up to the verified pageCount; the order is not by date. No job
// pages are requested: the role page already has the full descriptions.
// Compensation stays source text (equity and currencies mixed, no stated
// period). /role/<slug> is the one verified role page; no other is used.

export const wellfoundRolePage = "https://wellfound.com/role/customer-success-specialist";

export function wellfoundPageUrl(page: number): string {
  return page <= 1 ? wellfoundRolePage : `${wellfoundRolePage}?page=${page}`;
}

const configSchema = z.object({}).strict();
type WellfoundConfig = z.infer<typeof configSchema>;

const reference = z.object({ __ref: z.string() });
const remoteConfigSchema = z.object({ kind: z.string().nullish(), wfhFlexible: z.boolean().nullish() }).passthrough();
const listingSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
    slug: z.string().regex(/^[A-Za-z0-9-]+$/),
    title: z.string(),
    description: z.string().nullish(),
    jobType: z.string().nullish(),
    liveStartAt: z.number().nullish(),
    locationNames: z.array(z.string()).nullish(),
    acceptedRemoteLocationNames: z.array(z.string()).nullish(),
    remote: z.boolean().nullish(),
    remoteConfig: z.union([remoteConfigSchema, reference]).nullish(),
    compensation: z.string().nullish(),
    primaryRoleTitle: z.string().nullish(),
    yearsExperienceMin: z.number().nullish(),
    yearsExperienceMax: z.number().nullish(),
    atsSource: z.string().nullish(),
  })
  .passthrough();
const startupSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string().nullish(),
    highlightedJobListings: z.array(reference),
  })
  .passthrough();
const resultsSchema = z
  .object({
    totalJobCount: z.number().nullish(),
    perPage: z.number().nullish(),
    pageCount: z.number().int().nonnegative(),
    startups: z.array(reference),
  })
  .passthrough();
const stateSchema = z.object({
  props: z.object({
    pageProps: z.object({
      apolloState: z.object({ data: z.record(z.string(), z.unknown()) }),
    }),
  }),
});

interface PageListings {
  pageCount: number;
  totalJobCount: number | null;
  items: Array<{ listing: unknown; company: z.infer<typeof startupSchema> }>;
}

// The page's listings, each with its company, in page order. A document
// without the verified state is a contract change (a challenge or empty
// page included), never guessed around.
export function readWellfoundPage(html: string, url: string): PageListings {
  const state = stateSchema.safeParse(readJsonScript(html, "__NEXT_DATA__"));
  if (!state.success) throw new AdapterError("CONTRACT_MISMATCH", "The page has no readable listing state", { url });
  const data = state.data.props.pageProps.apolloState.data;
  const talent = z.object({ talent: z.record(z.string(), z.unknown()) }).safeParse(data.ROOT_QUERY);
  const key = talent.success ? Object.keys(talent.data.talent).find((name) => name.startsWith("seoLandingPageJobSearchResults(")) : undefined;
  const results = key ? resultsSchema.safeParse(talent.success ? talent.data.talent[key] : null) : null;
  if (!results?.success) throw new AdapterError("CONTRACT_MISMATCH", "The page has no job search results", { url });
  const items: PageListings["items"] = [];
  for (const startupRef of results.data.startups) {
    const company = startupSchema.safeParse(data[startupRef.__ref]);
    if (!company.success) throw new AdapterError("CONTRACT_MISMATCH", "A company in the results could not be read", { url });
    for (const listingRef of company.data.highlightedJobListings) {
      const listing = data[listingRef.__ref];
      // A remote configuration stored by reference is read from the state.
      const remote = (listing as { remoteConfig?: unknown } | undefined)?.remoteConfig;
      const remoteRef = reference.safeParse(remote);
      items.push({
        listing: remoteRef.success && listing && typeof listing === "object" ? { ...listing, remoteConfig: data[remoteRef.data.__ref] ?? null } : listing,
        company: company.data,
      });
    }
  }
  return { pageCount: results.data.pageCount, totalJobCount: results.data.totalJobCount ?? null, items };
}

// Only the explicit kinds map; ONSITE_OR_REMOTE and a bare remote flag
// stay source data.
function workplace(data: { kind?: string | null } | null) {
  const kind = data?.kind?.toUpperCase();
  if (kind === "REMOTE") return "REMOTE" as const;
  if (kind === "ONSITE") return "ONSITE" as const;
  return null;
}

export const wellfoundAdapter: SourceAdapter<WellfoundConfig> = {
  key: "wellfound",
  name: "Wellfound",
  retrievalType: "PUBLIC_HTML",
  sourceCategory: "MARKETPLACE",
  sourceType: "PUBLIC_SEARCH",
  configSchema,
  configFields: [],
  requiredEnv: [],
  verified: true,
  attribution: null,
  // At least 2 seconds between requests, and every verified page (11).
  minRequestIntervalMs: 2_000,
  maxPagesPerRun: 11,
  verificationUrl: () => wellfoundRolePage,
  collect(context) {
    let pageCount = 1;
    return collectPages(context, async (index) => {
      const page = index + 1;
      const url = wellfoundPageUrl(page);
      const html = await getText(context.transport, url, { accept: "text/html" });
      const read = readWellfoundPage(html, url);
      if (index === 0) pageCount = read.pageCount;
      const companies = new Map<string, z.infer<typeof startupSchema>>();
      const { valid, issues } = parseItems(listingSchema, read.items.map(({ listing }) => listing));
      for (const item of read.items) {
        const id = listingSchema.safeParse(item.listing).data?.id;
        if (id) companies.set(id, item.company);
      }
      const mapped = mapKeptItems(wellfoundAdapter, context, valid, {
        title: (listing) => listing.title,
        externalId: (listing) => listing.id,
        map: (listing) => {
          const company = companies.get(listing.id)!;
          const remoteConfig = listing.remoteConfig && "kind" in listing.remoteConfig ? listing.remoteConfig : null;
          const locations = [...new Set((listing.locationNames ?? []).map((name) => name.trim()).filter(Boolean))];
          const remoteLocations = [...new Set((listing.acceptedRemoteLocationNames ?? []).map((name) => name.trim()).filter(Boolean))];
          const jobUrl = `https://wellfound.com/jobs/${listing.id}-${listing.slug}`;
          return {
            externalId: listing.id,
            title: listing.title,
            company: company.name,
            location: locations.join("; ") || null,
            description: markdownToText(listing.description),
            employmentType: listing.jobType ?? null,
            postingDate: isoDate(listing.liveStartAt, "s"),
            sourceUrl: jobUrl,
            applicationUrl: jobUrl,
            structured: { workplaceType: workplace(remoteConfig) },
            material: {
              compensation: listing.compensation?.trim() || null,
              remote: listing.remote ?? null,
              remoteKind: remoteConfig?.kind ?? null,
              acceptedRemoteLocations: remoteLocations,
            },
            metadata: {
              companyId: company.id,
              companySlug: company.slug ?? null,
              // Source text only: equity and currencies are mixed and no
              // period is stated, so it is never normalized.
              compensation: listing.compensation?.trim() || null,
              remote: listing.remote ?? null,
              remoteKind: remoteConfig?.kind ?? null,
              wfhFlexible: remoteConfig?.wfhFlexible ?? null,
              acceptedRemoteLocations: remoteLocations,
              primaryRoleTitle: listing.primaryRoleTitle ?? null,
              yearsExperienceMin: listing.yearsExperienceMin ?? null,
              yearsExperienceMax: listing.yearsExperienceMax ?? null,
              atsSource: listing.atsSource ?? null,
              totalJobCount: read.totalJobCount,
            },
            sourceItem: { listing, company: { id: company.id, name: company.name, slug: company.slug ?? null } },
          };
        },
      });
      return {
        listings: mapped.listings,
        issues: [...issues, ...mapped.issues],
        fetched: read.items.length,
        more: read.items.length > 0 && page < pageCount,
      };
    });
  },
};
