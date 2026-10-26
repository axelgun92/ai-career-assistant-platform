import { htmlToText } from "@ai-career/normalization";
import { z } from "zod";
import { collectPages, mapKeptItems, parseItems, parseResponse } from "../collection";
import type { SourceAdapter } from "../contract";
import { getJson } from "../transport";
import { boardApplyBasis } from "./shared";

// Remote OK API (aggregator, official public feed). Verified October 17,
// 2026: one JSON array whose first element is the API terms notice (no
// job), followed by the latest jobs; no pagination. Its terms require a
// followed link back to Remote OK and naming it as the source, shown as the
// attribution. salary_min/salary_max carry no currency (0 means not given),
// so they are kept as source data only and never become a normalized salary.

const configSchema = z.object({}).strict();
type RemoteOkConfig = z.infer<typeof configSchema>;

const jobSchema = z
  .object({
    id: z.union([z.string(), z.number()]).transform(String),
    position: z.string(),
    company: z.string().nullish(),
    location: z.string().nullish(),
    description: z.string().nullish(),
    date: z.string().nullish(),
    url: z.string().nullish(),
    apply_url: z.string().nullish(),
    tags: z.array(z.string()).nullish(),
    salary_min: z.number().nullish(),
    salary_max: z.number().nullish(),
  })
  .passthrough();

const url = "https://remoteok.com/api";

export const remoteOkAdapter: SourceAdapter<RemoteOkConfig> = {
  key: "remote-ok",
  name: "Remote OK",
  retrievalType: "OFFICIAL_PUBLIC_API_FEED",
  sourceCategory: "AGGREGATOR",
  sourceType: "API",
  configSchema,
  configFields: [],
  requiredEnv: [],
  verified: true,
  attribution: "via Remote OK",
  verificationUrl: () => url,
  collect(context) {
    return collectPages(context, async () => {
      const response = parseResponse(z.array(z.unknown()), await getJson(context.transport, url), url);
      // The terms notice and anything else without a job id is not a job.
      const jobs = response.filter((item) => typeof item === "object" && item !== null && "id" in item);
      const { valid, issues } = parseItems(jobSchema, jobs);
      const mapped = mapKeptItems(remoteOkAdapter, context, valid, {
        title: (job) => job.position,
        externalId: (job) => job.id,
        map: (job) => ({
          externalId: job.id,
          title: job.position,
          company: job.company ?? null,
          location: job.location?.trim() ? job.location : null,
          description: htmlToText(job.description),
          postingDate: job.date ?? null,
          sourceUrl: job.url ?? null,
          applicationUrl: job.apply_url ?? job.url ?? null,
          // A distinct apply address; Remote OK often repeats its own listing
          // page there, which is not an application destination.
          sourceFacts: { applicationUrlBasis: boardApplyBasis(job.apply_url, job.url) },
          material: { tags: job.tags ?? [], statedSalaryMin: job.salary_min || null, statedSalaryMax: job.salary_max || null },
          metadata: {
            tags: job.tags ?? [],
            // Not normalized: the feed states no currency.
            statedSalaryMin: job.salary_min || null,
            statedSalaryMax: job.salary_max || null,
          },
          sourceItem: job,
        }),
      });
      return { listings: mapped.listings, issues: [...issues, ...mapped.issues], fetched: jobs.length, more: false };
    });
  },
};
