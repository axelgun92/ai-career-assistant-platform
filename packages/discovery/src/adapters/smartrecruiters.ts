import { htmlToText } from "@ai-career/normalization";
import { z } from "zod";
import { mapKeptItems, parseItems, parseResponse } from "../collection";
import { AdapterError, type CollectContext, type CollectResult, type ListingIssue, type SourceAdapter } from "../contract";
import { getJson } from "../transport";
import { slugSchema } from "./shared";

// SmartRecruiters Posting API (employer ATS, official public API). Verified
// October 18, 2026 against BoschGroup (the first target, Visa, returned an
// empty board): the list ({ offset, limit, totalFound, content }) is ordered
// newest first and has no description, so each kept posting's detail is
// read; its jobAd.sections (company description, job description,
// qualifications, additional information) hold the full HTML. Offset paging
// was verified with one request (offset echoed, totalFound unchanged, no
// overlap with page 1, same order): a run reads up to the page cap (with
// 100 per page, the newest 500 postings) and nothing older. Detail requests
// are capped per run and go to postings never stored first, oldest first,
// then to stored postings, longest since last checked first. The list's
// creator field can name a recruiter; it is kept only in the raw source data.

const configSchema = z
  .object({
    company: slugSchema,
    // Postings read from the list per run (the API's limit parameter).
    pageSize: z.number().int().min(1).max(100).default(100),
  })
  .strict();
type SmartRecruitersConfig = z.infer<typeof configSchema>;

const labelled = z.object({ id: z.string().nullish(), label: z.string().nullish() }).passthrough();
const summarySchema = z.object({ id: z.string().min(1), name: z.string(), releasedDate: z.string().nullish() }).passthrough();
type Summary = z.infer<typeof summarySchema>;
const listSchema = z.object({ content: z.array(z.unknown()), totalFound: z.number().nullish() }).passthrough();
const detailSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    refNumber: z.string().nullish(),
    releasedDate: z.string().nullish(),
    postingUrl: z.string().nullish(),
    applyUrl: z.string().nullish(),
    company: z.object({ name: z.string().nullish(), identifier: z.string().nullish() }).passthrough().nullish(),
    location: z
      .object({ fullLocation: z.string().nullish(), remote: z.boolean().nullish(), hybrid: z.boolean().nullish() })
      .passthrough()
      .nullish(),
    typeOfEmployment: labelled.nullish(),
    experienceLevel: labelled.nullish(),
    function: labelled.nullish(),
    department: labelled.nullish(),
    industry: labelled.nullish(),
    jobAd: z
      .object({
        sections: z.record(z.string(), z.object({ title: z.string().nullish(), text: z.string().nullish() }).passthrough()),
      })
      .passthrough(),
  })
  .passthrough();
type Detail = z.infer<typeof detailSchema>;

const sectionOrder = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"];
const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The job ad as one HTML document: the known sections in order, then any
// others, each under its own title.
export function smartRecruitersJobAdHtml(detail: Detail): string {
  const sections = detail.jobAd.sections;
  const keys = [...sectionOrder.filter((key) => key in sections), ...Object.keys(sections).filter((key) => !sectionOrder.includes(key))];
  return keys
    .map((key) => {
      const section = sections[key]!;
      return section.text?.trim() ? `<h3>${escapeText(section.title ?? "")}</h3>${section.text}` : "";
    })
    .join("");
}

// Explicit remote or hybrid flags only; neither set is not read as on-site.
function workplace(detail: Detail) {
  if (detail.location?.remote) return "REMOTE" as const;
  if (detail.location?.hybrid) return "HYBRID" as const;
  return null;
}

// The first page has no offset parameter (the verified first request).
const listUrl = (config: SmartRecruitersConfig, offset = 0) =>
  `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(config.company)}/postings?limit=${config.pageSize}${offset ? `&offset=${offset}` : ""}`;
const detailUrl = (config: SmartRecruitersConfig, id: string) =>
  `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(config.company)}/postings/${encodeURIComponent(id)}`;

const releasedTime = (summary: Summary) => {
  const time = summary.releasedDate ? Date.parse(summary.releasedDate) : Number.NaN;
  return Number.isNaN(time) ? null : time;
};

// Oldest posting first. A posting without a readable date goes after the
// dated ones; among those, later in the (newest-first) list counts as older.
function olderFirst(a: { summary: Summary; position: number }, b: { summary: Summary; position: number }) {
  const left = releasedTime(a.summary);
  const right = releasedTime(b.summary);
  if (left !== null && right !== null && left !== right) return left - right;
  if ((left === null) !== (right === null)) return left === null ? 1 : -1;
  return b.position - a.position;
}

// Which title matches get one of the run's detail requests (at most
// maxDetailRequests). Postings never stored from this source go first,
// oldest first: they are the closest to leaving the window a run can see.
// Stored postings get what is left, longest since last checked first, so a
// stored posting never holds a place ahead of an unseen one and stored
// postings take turns from run to run.
export async function prioritizeDetailRequests(
  context: Pick<CollectContext, "lastChecked" | "maxDetailRequests">,
  matches: readonly Summary[],
): Promise<Summary[]> {
  const cap = Math.max(0, context.maxDetailRequests);
  if (!matches.length || !cap) return [];
  const checked = context.lastChecked ? await context.lastChecked(matches.map((summary) => summary.id)) : new Map<string, Date>();
  const entries = matches.map((summary, position) => ({ summary, position, checkedAt: checked.get(summary.id)?.getTime() ?? null }));
  const unseen = entries.filter((entry) => entry.checkedAt === null).sort(olderFirst);
  const stored = entries
    .filter((entry) => entry.checkedAt !== null)
    .sort((a, b) => (a.checkedAt! !== b.checkedAt! ? a.checkedAt! - b.checkedAt! : olderFirst(a, b)));
  return [...unseen, ...stored].slice(0, cap).map((entry) => entry.summary);
}

export const smartRecruitersAdapter: SourceAdapter<SmartRecruitersConfig> = {
  key: "smartrecruiters",
  name: "SmartRecruiters",
  retrievalType: "OFFICIAL_PUBLIC_API_FEED",
  sourceCategory: "ATS",
  sourceType: "ATS",
  configSchema,
  configFields: [
    { name: "company", label: "Company identifier", help: "From the employer's SmartRecruiters job address, for example BoschGroup in jobs.smartrecruiters.com/BoschGroup (case-sensitive).", required: true },
  ],
  requiredEnv: [],
  verified: true,
  attribution: null,
  verificationUrl: (config) => listUrl({ ...config, pageSize: 10 }),
  verificationFollowUpUrl: (first, config) => {
    const parsed = listSchema.safeParse(first);
    const id = parsed.success ? summarySchema.safeParse(parsed.data.content[0]).data?.id : undefined;
    return id ? detailUrl(config, id) : null;
  },
  async collect(context, config): Promise<CollectResult> {
    const result: CollectResult = { listings: [], fetched: 0, issues: [], halted: null, requests: 0 };
    // Pages newest first, up to the page cap. A failure on the first page
    // fails the run; a later one stops paging and keeps what was read.
    const summaries: Summary[] = [];
    const seen = new Set<string>();
    let totalFound: number | null = null;
    for (let page = 0; page < Math.max(1, context.maxPages); page += 1) {
      const offset = page * config.pageSize;
      const url = listUrl(config, offset);
      let list: z.infer<typeof listSchema>;
      try {
        result.requests += 1;
        list = parseResponse(listSchema, await getJson(context.transport, url), url);
      } catch (error) {
        if (page === 0 || !(error instanceof AdapterError)) throw error;
        result.halted = error;
        break;
      }
      totalFound = list.totalFound ?? totalFound;
      result.fetched += list.content.length;
      const parsed = parseItems(summarySchema, list.content);
      result.issues.push(...parsed.issues);
      // A posting released while paging shifts later pages by one; it is
      // read once.
      for (const summary of parsed.valid) {
        if (seen.has(summary.id)) continue;
        seen.add(summary.id);
        summaries.push(summary);
      }
      const end = offset + list.content.length;
      if (list.content.length < config.pageSize || (list.totalFound != null && end >= list.totalFound)) break;
    }
    // After a 429 or an access refusal nothing more is requested.
    if (result.halted && (result.halted.code === "RATE_LIMITED" || result.halted.code === "ACCESS_DENIED")) return result;
    // Only titles that match are considered for a detail request.
    const kept = await prioritizeDetailRequests(
      context,
      summaries.filter((summary) => context.keepTitle(summary.name)),
    );
    const details: Detail[] = [];
    for (const summary of kept) {
      const address = detailUrl(config, summary.id);
      result.requests += 1;
      try {
        const parsed = detailSchema.safeParse(await getJson(context.transport, address));
        if (parsed.success) details.push(parsed.data);
        else result.issues.push({ externalId: summary.id, code: "CONTRACT_MISMATCH", message: "Posting detail does not match the expected shape" });
      } catch (error) {
        if (error instanceof AdapterError && (error.code === "RATE_LIMITED" || error.code === "ACCESS_DENIED")) {
          result.halted = error;
          break;
        }
        // A posting removed between the list and its detail, or one failed
        // request, affects that listing only.
        result.issues.push({ externalId: summary.id, code: "CONTRACT_MISMATCH", message: "Posting detail could not be read" } satisfies ListingIssue);
      }
    }
    const mapped = mapKeptItems(smartRecruitersAdapter, context, details, {
      title: (detail) => detail.name,
      externalId: (detail) => detail.id,
      map: (detail) => ({
        externalId: detail.id,
        requisitionId: detail.refNumber ?? null,
        title: detail.name,
        company: detail.company?.name ?? null,
        location: detail.location?.fullLocation ?? null,
        description: htmlToText(smartRecruitersJobAdHtml(detail)),
        employmentType: detail.typeOfEmployment?.label ?? null,
        postingDate: detail.releasedDate ?? null,
        sourceUrl: detail.postingUrl ?? null,
        applicationUrl: detail.applyUrl ?? detail.postingUrl ?? null,
        structured: { workplaceType: workplace(detail) },
        material: {
          experienceLevel: detail.experienceLevel?.label ?? null,
          function: detail.function?.label ?? null,
          department: detail.department?.label ?? null,
        },
        metadata: {
          companyIdentifier: detail.company?.identifier ?? config.company,
          experienceLevel: detail.experienceLevel?.label ?? null,
          function: detail.function?.label ?? null,
          department: detail.department?.label ?? null,
          industry: detail.industry?.label ?? null,
          totalFound,
        },
        sourceItem: detail,
      }),
    });
    result.listings.push(...mapped.listings);
    result.issues.push(...mapped.issues);
    return result;
  },
};
