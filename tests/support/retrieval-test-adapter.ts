import type { OpportunitySourceType, SourceCategory } from "@ai-career/core";
import {
  collectPages,
  getJson,
  mapKeptItems,
  parseResponse,
  type SourceAdapter,
  type TransportResponse,
} from "@ai-career/discovery";
import { htmlToText } from "@ai-career/normalization";
import { z } from "zod";

// A synthetic source adapter for framework tests. It is not a real source:
// its URLs use the reserved ".invalid" domain, so nothing can ever be
// fetched from the network, and tests serve its responses through the
// fixture transport. Real adapters are tested against their own verified
// fixtures.

export interface TestJob {
  id: string;
  title: string;
  company?: string | null;
  location?: string | null;
  html?: string | null;
  url?: string | null;
  apply_url?: string | null;
  requisition_id?: string | null;
  salary?: { min: number | null; max: number | null; currency: string; period: "YEAR" | "HOUR" } | null;
  workplace?: "REMOTE" | "HYBRID" | "ONSITE" | null;
  employment?: string | null;
  posted_at?: string | null;
  // Volatile response metadata a real source might send; never material.
  updated_at?: string;
  view_count?: number;
}

const jobSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    company: z.string().nullish(),
    location: z.string().nullish(),
    html: z.string().nullish(),
    url: z.string().nullish(),
    apply_url: z.string().nullish(),
    requisition_id: z.string().nullish(),
    salary: z
      .object({ min: z.number().nullable(), max: z.number().nullable(), currency: z.string(), period: z.enum(["YEAR", "HOUR"]) })
      .nullish(),
    workplace: z.enum(["REMOTE", "HYBRID", "ONSITE"]).nullish(),
    employment: z.string().nullish(),
    posted_at: z.string().nullish(),
  })
  .passthrough();
const pageSchema = z.object({ jobs: z.array(jobSchema), has_more: z.boolean().optional() }).passthrough();

export function testBoardUrl(key: string, board: string, page: number) {
  return `https://${key}.invalid/boards/${encodeURIComponent(board)}/jobs?page=${page}`;
}

export function createTestAdapter(options: {
  key?: string;
  name?: string;
  sourceCategory?: SourceCategory;
  sourceType?: OpportunitySourceType;
  verified?: boolean;
  requiredEnv?: string[];
  attribution?: string | null;
} = {}): SourceAdapter<{ board: string }> {
  const key = options.key ?? "test-board";
  const adapter: SourceAdapter<{ board: string }> = {
    key,
    name: options.name ?? "Test Board",
    retrievalType: "OFFICIAL_PUBLIC_API_FEED",
    sourceCategory: options.sourceCategory ?? "ATS",
    sourceType: options.sourceType ?? "ATS",
    configSchema: z.object({ board: z.string().trim().min(1).max(100) }).strict(),
    configFields: [{ name: "board", label: "Board", help: "The test board name.", required: true }],
    requiredEnv: options.requiredEnv ?? [],
    verified: options.verified ?? true,
    attribution: options.attribution ?? null,
    verificationUrl: (config) => testBoardUrl(key, config.board, 1),
    collect: (context, config) =>
      collectPages(context, async (page) => {
        const url = testBoardUrl(key, config.board, page + 1);
        const response = parseResponse(pageSchema, await getJson(context.transport, url), url);
        const mapped = mapKeptItems(adapter, context, response.jobs, {
          title: (job) => job.title,
          externalId: (job) => job.id,
          map: (job) => ({
            externalId: job.id,
            requisitionId: job.requisition_id ?? null,
            title: job.title,
            company: job.company ?? null,
            location: job.location ?? null,
            description: htmlToText(job.html),
            employmentType: job.employment ?? null,
            postingDate: job.posted_at ?? null,
            sourceUrl: job.url ?? null,
            applicationUrl: job.apply_url ?? job.url ?? null,
            structured: {
              ...(job.salary
                ? { salaryMin: job.salary.min, salaryMax: job.salary.max, salaryCurrency: job.salary.currency, salaryPeriod: job.salary.period }
                : {}),
              workplaceType: job.workplace ?? null,
            },
            metadata: { board: config.board },
            sourceItem: job,
          }),
        });
        return { ...mapped, fetched: response.jobs.length, more: response.has_more === true };
      }),
  };
  return adapter;
}

export function jsonResponse(body: unknown, status = 200): Omit<TransportResponse, "url"> {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}
