import { htmlToText } from "@ai-career/normalization";
import { z } from "zod";
import { collectPages, itemId, listingCoverage, mapKeptItems, parseItems, parseResponse } from "../collection";
import type { ListingCoverage, SourceAdapter } from "../contract";
import { getJson } from "../transport";
import { slugSchema } from "./shared";

// Greenhouse Job Board API (employer ATS, official public API). Verified
// October 17, 2026 against the gitlab board: one response with every job
// ({ jobs, meta: { total } }), no pagination. content is HTML escaped once
// more; there are no structured salary or workplace fields. updated_at is
// volatile and is kept as metadata only (never hashed). The board response is
// the whole board, so a complete run (every job with an id, as many as
// meta.total states) can show that a tracked job is gone (feature 13).

const configSchema = z.object({ board: slugSchema }).strict();
type GreenhouseConfig = z.infer<typeof configSchema>;

const named = z.object({ name: z.string().nullish() }).passthrough();
const jobSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    company_name: z.string().nullish(),
    requisition_id: z.string().nullish(),
    location: named.nullish(),
    absolute_url: z.string().nullish(),
    application_deadline: z.string().nullish(),
    content: z.string().nullish(),
    first_published: z.string().nullish(),
    updated_at: z.string().nullish(),
    departments: z.array(named).nullish(),
    offices: z.array(named).nullish(),
  })
  .passthrough();
const responseSchema = z.object({ jobs: z.array(z.unknown()), meta: z.object({ total: z.number() }).passthrough().nullish() }).passthrough();

const idSchema = z.object({ id: z.number().int() }).passthrough();

const names = (items: Array<{ name?: string | null }> | null | undefined) =>
  (items ?? []).map((item) => item.name?.trim()).filter((name): name is string => Boolean(name));

export const greenhouseAdapter: SourceAdapter<GreenhouseConfig> = {
  key: "greenhouse",
  name: "Greenhouse",
  retrievalType: "OFFICIAL_PUBLIC_API_FEED",
  sourceCategory: "ATS",
  sourceType: "ATS",
  configSchema,
  configFields: [
    { name: "board", label: "Board name", help: "From the employer's Greenhouse job-board address, for example gitlab in job-boards.greenhouse.io/gitlab.", required: true },
  ],
  requiredEnv: [],
  verified: true,
  attribution: null,
  verificationUrl: (config) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(config.board)}/jobs?content=true`,
  listingCoverage: "complete-board",
  trackingScope: (config) => ({ board: config.board }),
  async collect(context, config) {
    let coverage: ListingCoverage | undefined;
    const result = await collectPages(context, async () => {
      const url = greenhouseAdapter.verificationUrl(config);
      const response = parseResponse(responseSchema, await getJson(context.transport, url), url);
      coverage = listingCoverage(
        response.jobs.map((job) => itemId(idSchema, job, (value) => String(value.id))),
        { readWholeListing: true, statedTotal: response.meta?.total ?? null },
      );
      const { valid, issues } = parseItems(jobSchema, response.jobs);
      const mapped = mapKeptItems(greenhouseAdapter, context, valid, {
        title: (job) => job.title,
        externalId: (job) => String(job.id),
        map: (job) => ({
          externalId: String(job.id),
          requisitionId: job.requisition_id ?? null,
          title: job.title,
          company: job.company_name ?? null,
          location: job.location?.name ?? null,
          description: htmlToText(job.content),
          postingDate: job.first_published ?? null,
          sourceUrl: job.absolute_url ?? null,
          applicationUrl: job.absolute_url ?? null,
          // The application deadline is material only when stated, so boards
          // without one keep the hash they had.
          material: {
            departments: names(job.departments),
            offices: names(job.offices),
            ...(job.application_deadline ? { applicationDeadline: job.application_deadline } : {}),
          },
          // As stated, for the shared normalizer: a single department only.
          // The posting page (absolute_url) hosts the application form.
          sourceFacts: {
            department: names(job.departments).length === 1 ? names(job.departments)[0]! : null,
            closingDate: job.application_deadline ?? null,
            applicationUrlBasis: job.absolute_url ? "SOURCE_POSTING_PAGE" : null,
          },
          metadata: {
            board: config.board,
            firstPublished: job.first_published ?? null,
            updatedAt: job.updated_at ?? null,
            departments: names(job.departments),
            offices: names(job.offices),
          },
          sourceItem: job,
        }),
      });
      return { listings: mapped.listings, issues: [...issues, ...mapped.issues], fetched: response.jobs.length, more: false };
    });
    return coverage ? { ...result, coverage } : result;
  },
};
