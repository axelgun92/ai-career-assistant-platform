import { htmlToText } from "@ai-career/normalization";
import { z } from "zod";
import { collectPages, itemId, listingCoverage, mapKeptItems, parseItems, parseResponse } from "../collection";
import type { ListingCoverage, SourceAdapter } from "../contract";
import { getJson } from "../transport";
import { companyNameSchema, isoDate, slugSchema, workplaceType } from "./shared";

// Ashby Job Posting API (employer ATS, official public API). Verified
// October 17, 2026 against the ashby board: { apiVersion, jobs } with every
// posting, no pagination. Descriptions are HTML. Compensation is tiers of
// components. Only when the employer publishes compensation and states
// exactly one Salary component are the summary text and (per year, with a
// currency) the structured amounts used. With several tiers the summary is
// an envelope across tiers, sometimes in mixed currencies ("£59.5K – £76.5K
// … Multiple Ranges" over GBP and EUR tiers), so neither is normalized and
// every tier is kept as source data.
// The API returns no company name, so the source is configured with one.
// Unlisted postings are not retrieved. The response is the whole board, so a
// complete run can show that a tracked posting is gone or unlisted (feature
// 13); the configured company name is display-only, not retrieval scope.

const configSchema = z.object({ board: slugSchema, company: companyNameSchema }).strict();
type AshbyConfig = z.infer<typeof configSchema>;

const componentSchema = z
  .object({
    compensationType: z.string().nullish(),
    interval: z.string().nullish(),
    currencyCode: z.string().nullish(),
    minValue: z.number().nullish(),
    maxValue: z.number().nullish(),
  })
  .passthrough();
const jobSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    department: z.string().nullish(),
    team: z.string().nullish(),
    employmentType: z.string().nullish(),
    location: z.string().nullish(),
    secondaryLocations: z.array(z.object({ location: z.string().nullish() }).passthrough()).nullish(),
    publishedAt: z.string().nullish(),
    isListed: z.boolean().nullish(),
    isRemote: z.boolean().nullish(),
    workplaceType: z.string().nullish(),
    jobUrl: z.string().nullish(),
    applyUrl: z.string().nullish(),
    descriptionHtml: z.string().nullish(),
    shouldDisplayCompensationOnJobPostings: z.boolean().nullish(),
    compensation: z
      .object({
        compensationTierSummary: z.string().nullish(),
        compensationTiers: z.array(z.object({ components: z.array(componentSchema).nullish() }).passthrough()).nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();
const responseSchema = z.object({ jobs: z.array(z.unknown()) }).passthrough();
type AshbyJob = z.infer<typeof jobSchema>;

function salaryComponents(job: AshbyJob) {
  return (job.compensation?.compensationTiers ?? [])
    .flatMap((tier) => tier.components ?? [])
    .filter((component) => component.compensationType === "Salary");
}

// The published single salary, or nothing.
export function ashbyStructuredSalary(job: AshbyJob) {
  if (!job.shouldDisplayCompensationOnJobPostings) return {};
  const salaries = salaryComponents(job);
  const [salary] = salaries;
  if (salaries.length !== 1 || !salary || salary.interval !== "1 YEAR" || !salary.currencyCode) return {};
  return { salaryMin: salary.minValue ?? null, salaryMax: salary.maxValue ?? null, salaryCurrency: salary.currencyCode, salaryPeriod: "YEAR" as const };
}

// The summary text, only when it describes a single published salary.
export function ashbySalaryText(job: AshbyJob): string | null {
  if (!job.shouldDisplayCompensationOnJobPostings || salaryComponents(job).length !== 1) return null;
  return job.compensation?.compensationTierSummary ?? null;
}

const secondary = (job: AshbyJob) =>
  (job.secondaryLocations ?? []).map((item) => item.location?.trim()).filter((value): value is string => Boolean(value));

export const ashbyAdapter: SourceAdapter<AshbyConfig> = {
  key: "ashby",
  name: "Ashby",
  retrievalType: "OFFICIAL_PUBLIC_API_FEED",
  sourceCategory: "ATS",
  sourceType: "ATS",
  configSchema,
  configFields: [
    { name: "board", label: "Board name", help: "From the employer's Ashby job-board address, for example ashby in jobs.ashbyhq.com/ashby.", required: true },
    { name: "company", label: "Company name", help: "Ashby does not return the employer's name, so it is taken from here.", required: true },
  ],
  requiredEnv: [],
  verified: true,
  attribution: null,
  verificationUrl: (config) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(config.board)}?includeCompensation=true`,
  listingCoverage: "complete-board",
  trackingScope: (config) => ({ board: config.board }),
  async collect(context, config) {
    let coverage: ListingCoverage | undefined;
    const result = await collectPages(context, async () => {
      const url = ashbyAdapter.verificationUrl(config);
      const response = parseResponse(responseSchema, await getJson(context.transport, url), url);
      // Unlisted postings are not on the public board, for coverage too.
      const coverageItem = z.object({ id: z.string(), isListed: z.boolean().nullish() }).passthrough();
      coverage = listingCoverage(
        response.jobs
          .filter((job) => coverageItem.safeParse(job).data?.isListed !== false)
          .map((job) => itemId(coverageItem, job, (value) => value.id)),
        { readWholeListing: true },
      );
      const { valid, issues } = parseItems(jobSchema, response.jobs);
      const listed = valid.filter((job) => job.isListed !== false);
      const mapped = mapKeptItems(ashbyAdapter, context, listed, {
        title: (job) => job.title,
        externalId: (job) => job.id,
        map: (job) => ({
          externalId: job.id,
          title: job.title,
          company: config.company,
          location: job.location ?? null,
          description: htmlToText(job.descriptionHtml),
          salaryText: ashbySalaryText(job),
          employmentType: job.employmentType ?? null,
          postingDate: isoDate(job.publishedAt),
          sourceUrl: job.jobUrl ?? null,
          applicationUrl: job.applyUrl ?? job.jobUrl ?? null,
          structured: { ...ashbyStructuredSalary(job), workplaceType: workplaceType(job.workplaceType) },
          material: {
            department: job.department ?? null,
            team: job.team ?? null,
            secondaryLocations: secondary(job),
            compensation: JSON.stringify(job.compensation?.compensationTiers ?? []),
          },
          metadata: {
            board: config.board,
            companySource: "configured",
            department: job.department ?? null,
            team: job.team ?? null,
            secondaryLocations: secondary(job),
            isRemote: job.isRemote ?? null,
            workplaceType: job.workplaceType ?? null,
            compensationSummary: job.compensation?.compensationTierSummary ?? null,
            salaryTierCount: salaryComponents(job).length,
          },
          sourceItem: job,
        }),
      });
      return { listings: mapped.listings, issues: [...issues, ...mapped.issues], fetched: response.jobs.length, more: false };
    });
    return coverage ? { ...result, coverage } : result;
  },
};
