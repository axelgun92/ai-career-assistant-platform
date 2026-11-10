import { htmlToText } from "@ai-career/normalization";
import { z } from "zod";
import { collectPages, mapKeptItems, parseItems, parseResponse } from "../collection";
import type { SourceAdapter } from "../contract";
import { getJson } from "../transport";
import { isoDate, workplaceType } from "./shared";

// Jobs by Workable search (global job search across Workable employers;
// public/guest internal endpoint, Type 3). Verified October 18, 2026 from
// networks that can reach it (this environment's first request was
// rate-limited, a network/reputation condition, not the contract):
// GET https://jobs.workable.com/api/v1/jobs?query=customer%20success returns
// { title, totalSize, nextPageToken, jobs[], autoAppliedFilters }; the next
// page is the same request with &pageToken=<nextPageToken> (20 jobs per page
// observed, no overlap, same totalSize). Each job carries id, title,
// company, its complete text as HTML in three sections (description,
// requirementsSection, benefitsSection, joined here in that order),
// employmentType (sometimes empty), locations (strings; "TELECOMMUTE"
// marks remote work and is not a place), location, workplace (remote,
// on_site, hybrid), created, updated and url, so no detail requests are
// made. The
// order is search relevance, not date: a run reads a bounded window of the
// results (up to the page cap). The query is broad (it matches more than
// titles), so the local title filter still decides what is kept.
// Workable's official XML feed (about 850 MB, whole-feed download) was
// verified as a contingency only and is not used.

export const workableQuery = "customer success";
const searchUrl = `https://jobs.workable.com/api/v1/jobs?query=${encodeURIComponent(workableQuery)}`;

export function workablePageUrl(pageToken: string | null): string {
  return pageToken ? `${searchUrl}&pageToken=${encodeURIComponent(pageToken)}` : searchUrl;
}

const configSchema = z.object({}).strict();
type WorkableConfig = z.infer<typeof configSchema>;

const jobSchema = z
  .object({
    id: z.union([z.string().min(1), z.number()]).transform(String),
    title: z.string(),
    company: z.object({ id: z.union([z.string(), z.number()]).nullish(), title: z.string().nullish(), website: z.string().nullish() }).passthrough().nullish(),
    description: z.string().nullish(),
    requirementsSection: z.string().nullish(),
    benefitsSection: z.string().nullish(),
    employmentType: z.string().nullish(),
    locations: z.array(z.string()).nullish(),
    location: z.object({ city: z.string().nullish(), subregion: z.string().nullish(), countryName: z.string().nullish() }).passthrough().nullish(),
    workplace: z.string().nullish(),
    department: z.string().nullish(),
    state: z.string().nullish(),
    language: z.string().nullish(),
    created: z.string().nullish(),
    updated: z.string().nullish(),
    url: z.string().nullish(),
  })
  .passthrough();
type Job = z.infer<typeof jobSchema>;
const responseSchema = z.object({ jobs: z.array(z.unknown()), totalSize: z.number().nullish(), nextPageToken: z.string().nullish() }).passthrough();

const telecommute = "TELECOMMUTE";
const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The places a job names; the remote marker is left to the workplace field.
function locationsOf(job: Job): string[] {
  const places = (job.locations ?? []).map((value) => value.trim()).filter((value) => value && value.toUpperCase() !== telecommute);
  if (places.length) return [...new Set(places)];
  const parts = [job.location?.city, job.location?.subregion, job.location?.countryName].map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  return parts.length ? [[...new Set(parts)].join(", ")] : [];
}

// The complete posting text: the description, then the requirements and
// benefits sections under their own headings.
export function workableJobHtml(job: Pick<Job, "description" | "requirementsSection" | "benefitsSection">): string {
  const sections: Array<[string | null, string | null | undefined]> = [
    [null, job.description],
    ["Requirements", job.requirementsSection],
    ["Benefits", job.benefitsSection],
  ];
  return sections
    .filter(([, html]) => html?.trim())
    .map(([heading, html]) => `${heading ? `<h3>${escapeText(heading)}</h3>` : ""}${html}`)
    .join("");
}

export const workableAdapter: SourceAdapter<WorkableConfig> = {
  key: "workable",
  name: "Workable",
  retrievalType: "PUBLIC_GUEST_INTERNAL_ENDPOINT",
  sourceCategory: "JOB_BOARD",
  sourceType: "PUBLIC_SEARCH",
  configSchema,
  configFields: [],
  requiredEnv: [],
  verified: true,
  attribution: null,
  verificationUrl: () => workablePageUrl(null),
  verificationFollowUpUrl: (first) => {
    const parsed = responseSchema.safeParse(first);
    return parsed.success && parsed.data.nextPageToken ? workablePageUrl(parsed.data.nextPageToken) : null;
  },
  collect(context) {
    let pageToken: string | null = null;
    return collectPages(context, async (page) => {
      const url = workablePageUrl(page === 0 ? null : pageToken);
      const response = parseResponse(responseSchema, await getJson(context.transport, url), url);
      pageToken = response.nextPageToken ?? null;
      const { valid, issues } = parseItems(jobSchema, response.jobs);
      const mapped = mapKeptItems(workableAdapter, context, valid, {
        title: (job) => job.title,
        externalId: (job) => job.id,
        map: (job) => {
          const locations = locationsOf(job);
          return {
            externalId: job.id,
            title: job.title,
            company: job.company?.title?.trim() || null,
            location: locations.join("; ") || null,
            description: htmlToText(workableJobHtml(job)),
            employmentType: job.employmentType?.trim() || null,
            postingDate: isoDate(job.created),
            sourceUrl: job.url ?? null,
            applicationUrl: job.url ?? null,
            structured: { workplaceType: workplaceType(job.workplace) },
            sourceFacts: {
              department: job.department?.trim() || null,
              // A jobs.workable.com listing page, which links on to the application.
              applicationUrlBasis: job.url ? "SOURCE_LISTING_PAGE" : null,
            },
            material: { department: job.department ?? null, workplace: job.workplace ?? null, locations },
            metadata: {
              companyId: job.company?.id === null || job.company?.id === undefined ? null : String(job.company.id),
              companyWebsite: job.company?.website ?? null,
              department: job.department ?? null,
              workplace: job.workplace ?? null,
              remote: (job.locations ?? []).some((value) => value.trim().toUpperCase() === telecommute),
              state: job.state ?? null,
              language: job.language ?? null,
              // Freshness stamp, never material.
              updatedAt: job.updated ?? null,
              totalSize: response.totalSize ?? null,
            },
            sourceItem: job,
          };
        },
      });
      return {
        listings: mapped.listings,
        issues: [...issues, ...mapped.issues],
        fetched: response.jobs.length,
        more: Boolean(pageToken) && response.jobs.length > 0,
      };
    });
  },
};
