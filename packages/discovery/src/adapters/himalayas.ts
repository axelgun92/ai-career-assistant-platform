import { htmlToText } from "@ai-career/normalization";
import { z } from "zod";
import { collectPages, mapKeptItems, parseItems, parseResponse } from "../collection";
import type { SourceAdapter } from "../contract";
import { getJson } from "../transport";
import { boardApplyBasis, isoDate } from "./shared";

// Himalayas jobs API (aggregator, official public API). Verified October
// 17–18, 2026 with ?limit=20 and, for page 2, ?limit=20&cursor=<nextCursor>
// (the paging the response itself documents; offset is deprecated):
// { comments, updatedAt, offset, limit, totalCount, nextCursor, jobs }, newest
// jobs first. Pages are followed by nextCursor up to the run's page cap.
// Salary amounts, period and currency are structured;
// locationRestrictions and timezoneRestrictions are kept as source data
// (a time-zone requirement is never normalized from retrieval).

const configSchema = z.object({}).strict();
type HimalayasConfig = z.infer<typeof configSchema>;

const jobSchema = z
  .object({
    guid: z.string().min(1),
    title: z.string(),
    companyName: z.string().nullish(),
    employmentType: z.string().nullish(),
    minSalary: z.number().nullish(),
    maxSalary: z.number().nullish(),
    salaryPeriod: z.string().nullish(),
    currency: z.string().nullish(),
    seniority: z.array(z.string()).nullish(),
    locationRestrictions: z.array(z.string()).nullish(),
    timezoneRestrictions: z.array(z.number()).nullish(),
    categories: z.array(z.string()).nullish(),
    description: z.string().nullish(),
    pubDate: z.number().nullish(),
    expiryDate: z.number().nullish(),
    applicationLink: z.string().nullish(),
  })
  .passthrough();
const responseSchema = z.object({ jobs: z.array(z.unknown()), totalCount: z.number().nullish(), nextCursor: z.string().nullish() }).passthrough();

const periods: Record<string, "YEAR" | "MONTH" | "WEEK" | "DAY" | "HOUR"> = {
  annual: "YEAR",
  yearly: "YEAR",
  monthly: "MONTH",
  weekly: "WEEK",
  daily: "DAY",
  hourly: "HOUR",
};

const firstPageUrl = "https://himalayas.app/jobs/api?limit=20";

export function himalayasPageUrl(cursor: string | null): string {
  return cursor ? `${firstPageUrl}&cursor=${encodeURIComponent(cursor)}` : firstPageUrl;
}

export const himalayasAdapter: SourceAdapter<HimalayasConfig> = {
  key: "himalayas",
  name: "Himalayas",
  retrievalType: "OFFICIAL_PUBLIC_API_FEED",
  sourceCategory: "AGGREGATOR",
  sourceType: "API",
  configSchema,
  configFields: [],
  requiredEnv: [],
  verified: true,
  attribution: null,
  verificationUrl: () => firstPageUrl,
  verificationFollowUpUrl: (first) => {
    const parsed = responseSchema.safeParse(first);
    return parsed.success && parsed.data.nextCursor ? himalayasPageUrl(parsed.data.nextCursor) : null;
  },
  collect(context) {
    let cursor: string | null = null;
    return collectPages(context, async (page) => {
      const url = himalayasPageUrl(page === 0 ? null : cursor);
      const response = parseResponse(responseSchema, await getJson(context.transport, url), url);
      cursor = response.nextCursor ?? null;
      const { valid, issues } = parseItems(jobSchema, response.jobs);
      const mapped = mapKeptItems(himalayasAdapter, context, valid, {
        title: (job) => job.title,
        externalId: (job) => job.guid,
        map: (job) => ({
          externalId: job.guid,
          title: job.title,
          company: job.companyName ?? null,
          location: (job.locationRestrictions ?? []).join(", ") || null,
          description: htmlToText(job.description),
          employmentType: job.employmentType ?? null,
          postingDate: isoDate(job.pubDate, "s"),
          sourceUrl: job.applicationLink ?? job.guid,
          applicationUrl: job.applicationLink ?? job.guid,
          structured:
            job.minSalary !== null && job.minSalary !== undefined
              ? {
                  salaryMin: job.minSalary,
                  salaryMax: job.maxSalary ?? null,
                  salaryCurrency: job.currency ?? null,
                  salaryPeriod: periods[job.salaryPeriod?.toLowerCase() ?? ""] ?? null,
                }
              : {},
          sourceFacts: {
            seniority: (job.seniority ?? []).map((value) => value.trim()).filter(Boolean),
            // The employer's application link; Himalayas often repeats its
            // own listing page (the guid) there, which is not one.
            applicationUrlBasis: boardApplyBasis(job.applicationLink, job.guid) ?? "SOURCE_LISTING_PAGE",
            // Where the remote role may be done from ("United States only").
            remoteLocations: (job.locationRestrictions ?? []).map((value) => value.trim()).filter(Boolean),
          },
          material: {
            locationRestrictions: job.locationRestrictions ?? [],
            timezoneRestrictions: (job.timezoneRestrictions ?? []).map(String),
            seniority: job.seniority ?? [],
          },
          metadata: {
            locationRestrictions: job.locationRestrictions ?? [],
            timezoneRestrictions: job.timezoneRestrictions ?? [],
            seniority: job.seniority ?? [],
            categories: job.categories ?? [],
            expiresAt: isoDate(job.expiryDate, "s"),
          },
          sourceItem: job,
        }),
      });
      return {
        listings: mapped.listings,
        issues: [...issues, ...mapped.issues],
        fetched: response.jobs.length,
        more: Boolean(cursor) && response.jobs.length > 0,
      };
    });
  },
};
