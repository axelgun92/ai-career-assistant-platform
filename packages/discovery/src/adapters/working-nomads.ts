import { htmlToText } from "@ai-career/normalization";
import { z } from "zod";
import { collectPages, mapKeptItems, parseItems, parseResponse } from "../collection";
import type { SourceAdapter } from "../contract";
import { getJson } from "../transport";
import { isoDate } from "./shared";

// Working Nomads exposed jobs API (aggregator, official public feed).
// Verified October 17, 2026: one JSON array of recent jobs with url, title,
// HTML description, company_name, category_name, tags (comma-separated),
// location (free text) and pub_date; no pagination and no id field, so the
// listing identity is the number in its url (/job/go/<number>/), or the url.

const configSchema = z.object({}).strict();
type WorkingNomadsConfig = z.infer<typeof configSchema>;

const jobSchema = z
  .object({
    url: z.string().min(1),
    title: z.string(),
    description: z.string().nullish(),
    company_name: z.string().nullish(),
    category_name: z.string().nullish(),
    tags: z.string().nullish(),
    location: z.string().nullish(),
    pub_date: z.string().nullish(),
  })
  .passthrough();

export function workingNomadsId(url: string): string {
  return /\/job\/go\/(\d+)\/?$/.exec(url)?.[1] ?? url;
}

const tagList = (value: string | null | undefined) =>
  (value ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);

const url = "https://www.workingnomads.com/api/exposed_jobs/";

export const workingNomadsAdapter: SourceAdapter<WorkingNomadsConfig> = {
  key: "working-nomads",
  name: "Working Nomads",
  retrievalType: "OFFICIAL_PUBLIC_API_FEED",
  sourceCategory: "AGGREGATOR",
  sourceType: "API",
  configSchema,
  configFields: [],
  requiredEnv: [],
  verified: true,
  attribution: null,
  verificationUrl: () => url,
  collect(context) {
    return collectPages(context, async () => {
      const response = parseResponse(z.array(z.unknown()), await getJson(context.transport, url), url);
      const { valid, issues } = parseItems(jobSchema, response);
      const mapped = mapKeptItems(workingNomadsAdapter, context, valid, {
        title: (job) => job.title,
        externalId: (job) => workingNomadsId(job.url),
        map: (job) => ({
          externalId: workingNomadsId(job.url),
          title: job.title,
          company: job.company_name ?? null,
          location: job.location ?? null,
          description: htmlToText(job.description),
          postingDate: isoDate(job.pub_date),
          sourceUrl: job.url,
          applicationUrl: job.url,
          // Working Nomads' own link to the listing.
          sourceFacts: { applicationUrlBasis: "SOURCE_LISTING_PAGE" },
          material: { category: job.category_name ?? null, tags: tagList(job.tags) },
          metadata: { category: job.category_name ?? null, tags: tagList(job.tags) },
          sourceItem: job,
        }),
      });
      return { listings: mapped.listings, issues: [...issues, ...mapped.issues], fetched: response.length, more: false };
    });
  },
};
