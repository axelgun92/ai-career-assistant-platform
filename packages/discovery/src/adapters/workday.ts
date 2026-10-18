import { htmlToText } from "@ai-career/normalization";
import { z } from "zod";
import { mapKeptItems, parseItems, parseResponse, prioritizeDetailRequests } from "../collection";
import { AdapterError, isStopError, type CollectResult, type ListingIssue, type SourceAdapter } from "../contract";
import { getJson, postJson } from "../transport";
import { companyNameSchema, isoDate } from "./shared";

// Workday career sites (employer ATS, public/guest internal endpoint).
// Verified October 18, 2026 against workday.wd5.myworkdayjobs.com/Workday,
// statelessly (no cookies or session values):
// - the career-site document is an application shell whose configuration
//   names the tenant and site (appName "cxs");
// - the list is POST /wday/cxs/<tenant>/<site>/jobs with
//   {"appliedFacets":{},"limit":20,"offset":<n>,"searchText":""}, returning
//   { total, jobPostings[], facets[], userAuthenticated:false }; each posting
//   has only title, externalPath, locationsText, postedOn (relative text),
//   remoteType and bulletFields[0] (the requisition); total and facets are
//   filled on the first page only (0 and [] on later pages);
// - the detail is GET /wday/cxs/<tenant>/<site><externalPath>, returning
//   jobPostingInfo (complete HTML description, locations, startDate,
//   timeType, jobReqId, remoteType, externalUrl, ...) and
//   hiringOrganization.name.
// Pages are read by offset up to the page cap: a bounded window of the first
// 100 postings the listing endpoint returns (20 per page). Workday does not
// state the order; the verified pages looked newest first, which is not
// relied on. Detail
// requests go to title matches only, capped per run, unseen listings first.
// postedOn, timeLeftToApply and similarJobs change daily and are never
// material; pay ranges appear only in the description text and are not
// normalized.

const pageSize = 20;
const workdayHost = /^([a-z0-9][a-z0-9-]*)\.(wd\d+)\.myworkdayjobs\.com$/i;
const localeSegment = /^[a-z]{2}(?:-[A-Za-z]{2})?$/;
const sitePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

// The career-site address as an employer publishes it, for example
// https://workday.wd5.myworkdayjobs.com/Workday or .../en-US/Workday.
export function parseWorkdayCareerSite(value: string): { host: string; tenant: string; site: string } | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const host = workdayHost.exec(url.hostname);
  if (url.protocol !== "https:" || !host || url.port) return null;
  const segments = url.pathname.split("/").filter(Boolean);
  const site = segments.length === 2 && localeSegment.test(segments[0]!) ? segments[1] : segments.length === 1 ? segments[0] : undefined;
  if (!site || !sitePattern.test(site)) return null;
  return { host: url.hostname.toLowerCase(), tenant: host[1]!.toLowerCase(), site };
}

const configSchema = z
  .object({
    careerSite: z
      .string()
      .trim()
      .max(300)
      .refine((value) => parseWorkdayCareerSite(value) !== null, "Use the career site's address, for example https://acme.wd5.myworkdayjobs.com/External"),
    // Used only when a posting's detail names no hiring organization.
    company: companyNameSchema.optional(),
  })
  .strict();
type WorkdayConfig = z.infer<typeof configSchema>;

const postingSchema = z
  .object({
    title: z.string(),
    // A posting path on the same site; anything else is not requested.
    externalPath: z.string().regex(/^\/job\/[^?#\\]+$/).refine((path) => !path.includes("//") && !path.split("/").includes("..")),
    locationsText: z.string().nullish(),
    postedOn: z.string().nullish(),
    remoteType: z.string().nullish(),
    bulletFields: z.array(z.string()).nullish(),
  })
  .passthrough();
type Posting = z.infer<typeof postingSchema>;
const listSchema = z.object({ total: z.number().nullish(), jobPostings: z.array(z.unknown()) }).passthrough();
const detailSchema = z
  .object({
    jobPostingInfo: z
      .object({
        id: z.string().nullish(),
        title: z.string(),
        jobDescription: z.string().nullish(),
        location: z.string().nullish(),
        additionalLocations: z.array(z.string()).nullish(),
        postedOn: z.string().nullish(),
        startDate: z.string().nullish(),
        endDate: z.string().nullish(),
        timeType: z.string().nullish(),
        jobReqId: z.string().nullish(),
        remoteType: z.string().nullish(),
        externalUrl: z.string().nullish(),
        country: z.object({ descriptor: z.string().nullish() }).passthrough().nullish(),
      })
      .passthrough(),
    hiringOrganization: z.object({ name: z.string().nullish() }).passthrough().nullish(),
  })
  .passthrough();
type Detail = z.infer<typeof detailSchema>;

export const workdayListBody = (offset: number) => ({ appliedFacets: {}, limit: pageSize, offset, searchText: "" });

function site(config: WorkdayConfig) {
  return parseWorkdayCareerSite(config.careerSite)!;
}
const listUrl = (config: WorkdayConfig) => {
  const { host, tenant, site: name } = site(config);
  return `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(name)}/jobs`;
};
const detailUrl = (config: WorkdayConfig, externalPath: string) => {
  const { host, tenant, site: name } = site(config);
  return `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(name)}${externalPath}`;
};
// Listing identity: tenant, site and the posting path (visible in the list,
// so unseen postings can be told apart before any detail request).
export const workdayListingId = (config: WorkdayConfig, externalPath: string) => {
  const { tenant, site: name } = site(config);
  return `${tenant}/${name}:${externalPath}`;
};

// Workday's own vocabulary: only Remote and Onsite map; Flex is kept as
// source data and never read as hybrid.
function workplace(remoteType: string | null | undefined) {
  const key = remoteType?.trim().toLowerCase();
  if (key === "remote") return "REMOTE" as const;
  if (key === "onsite" || key === "on-site") return "ONSITE" as const;
  return null;
}

export const workdayAdapter: SourceAdapter<WorkdayConfig> = {
  key: "workday",
  name: "Workday",
  retrievalType: "PUBLIC_GUEST_INTERNAL_ENDPOINT",
  sourceCategory: "ATS",
  sourceType: "ATS",
  configSchema,
  configFields: [
    {
      name: "careerSite",
      label: "Career site address",
      help: "The employer's Workday jobs address, for example https://acme.wd5.myworkdayjobs.com/External.",
      required: true,
    },
    {
      name: "company",
      label: "Company name",
      help: "Used only for postings whose details do not name the employer.",
      required: false,
    },
  ],
  requiredEnv: [],
  verified: true,
  attribution: null,
  verificationUrl: (config) => listUrl(config),
  verificationBody: () => workdayListBody(0),
  verificationFollowUpUrl: (first, config) => {
    const parsed = listSchema.safeParse(first);
    const posting = parsed.success ? postingSchema.safeParse(parsed.data.jobPostings[0]).data : undefined;
    return posting ? detailUrl(config, posting.externalPath) : null;
  },
  async collect(context, config): Promise<CollectResult> {
    const result: CollectResult = { listings: [], fetched: 0, issues: [], halted: null, requests: 0 };
    const url = listUrl(config);
    // Pages by offset up to the page cap. The total is read from the first
    // page only (later pages report 0). A failure on the first page fails
    // the run; a later one stops paging and keeps what was read.
    const postings: Posting[] = [];
    const seen = new Set<string>();
    let total: number | null = null;
    for (let page = 0; page < Math.max(1, context.maxPages); page += 1) {
      const offset = page * pageSize;
      let list: z.infer<typeof listSchema>;
      try {
        result.requests += 1;
        list = parseResponse(listSchema, await postJson(context.transport, url, workdayListBody(offset)), url);
      } catch (error) {
        if (page === 0 || !(error instanceof AdapterError)) throw error;
        result.halted = error;
        break;
      }
      if (page === 0) total = list.total ?? null;
      result.fetched += list.jobPostings.length;
      const parsed = parseItems(postingSchema, list.jobPostings);
      result.issues.push(...parsed.issues);
      // A posting released while paging shifts later pages by one; it is
      // read once.
      for (const posting of parsed.valid) {
        if (seen.has(posting.externalPath)) continue;
        seen.add(posting.externalPath);
        postings.push(posting);
      }
      const end = offset + list.jobPostings.length;
      if (list.jobPostings.length < pageSize || (total !== null && end >= total)) break;
    }
    // After a 429, an access refusal or a server error nothing more is requested.
    if (result.halted && isStopError(result.halted)) return result;
    const matches = postings
      .filter((posting) => context.keepTitle(posting.title))
      .map((posting) => ({ id: workdayListingId(config, posting.externalPath), posting }));
    const kept = await prioritizeDetailRequests(context, matches);
    const details: Array<{ posting: Posting; detail: Detail }> = [];
    for (const { posting } of kept) {
      result.requests += 1;
      try {
        const parsed = detailSchema.safeParse(await getJson(context.transport, detailUrl(config, posting.externalPath)));
        if (parsed.success) details.push({ posting, detail: parsed.data });
        else result.issues.push({ externalId: workdayListingId(config, posting.externalPath), code: "CONTRACT_MISMATCH", message: "Posting detail does not match the expected shape" });
      } catch (error) {
        if (isStopError(error)) {
          result.halted = error;
          break;
        }
        // A posting removed between the list and its detail, or one failed
        // request, affects that listing only.
        result.issues.push({ externalId: workdayListingId(config, posting.externalPath), code: "CONTRACT_MISMATCH", message: "Posting detail could not be read" } satisfies ListingIssue);
      }
    }
    const { host, tenant, site: name } = site(config);
    const mapped = mapKeptItems(workdayAdapter, context, details, {
      title: ({ detail }) => detail.jobPostingInfo.title,
      externalId: ({ posting }) => workdayListingId(config, posting.externalPath),
      map: ({ posting, detail }) => {
        const info = detail.jobPostingInfo;
        const organization = detail.hiringOrganization?.name?.trim() || null;
        const company = organization ?? config.company ?? null;
        const locations = [...new Set([info.location, ...(info.additionalLocations ?? [])].filter((value): value is string => Boolean(value?.trim())))];
        const pageUrl = info.externalUrl ?? `https://${host}/${name}${posting.externalPath}`;
        const remoteType = info.remoteType ?? posting.remoteType ?? null;
        // The daily-changing similarJobs list is not kept.
        const { similarJobs: _similarJobs, ...sourceDetail } = detail;
        return {
          externalId: workdayListingId(config, posting.externalPath),
          requisitionId: info.jobReqId ?? posting.bulletFields?.[0] ?? null,
          title: info.title,
          company,
          location: locations.join("; ") || posting.locationsText || null,
          description: htmlToText(info.jobDescription),
          employmentType: info.timeType ?? null,
          postingDate: isoDate(info.startDate),
          sourceUrl: pageUrl,
          applicationUrl: pageUrl,
          structured: { workplaceType: workplace(remoteType) },
          material: { remoteType, locations },
          metadata: {
            tenant,
            site: name,
            externalPath: posting.externalPath,
            postingId: info.id ?? null,
            remoteType,
            country: info.country?.descriptor ?? null,
            endDate: info.endDate ?? null,
            // Relative text such as "Posted 3 Days Ago"; startDate is the date.
            postedOn: info.postedOn ?? posting.postedOn ?? null,
            ...(organization ? {} : company ? { companySource: "configured" } : {}),
          },
          sourceItem: { listing: posting, detail: sourceDetail },
        };
      },
    });
    result.listings.push(...mapped.listings);
    result.issues.push(...mapped.issues);
    return result;
  },
};
