import { htmlToText } from "@ai-career/normalization";
import { z } from "zod";
import { collectPages, itemId, listingCoverage, mapKeptItems, parseItems, parseResponse } from "../collection";
import type { ListingCoverage, SourceAdapter } from "../contract";
import { getJson } from "../transport";
import { companyNameSchema, isoDate, slugSchema, workplaceType } from "./shared";

// Lever Postings API (employer ATS, official public API). Verified October
// 17, 2026 against the palantir site: one JSON array of every posting, no
// pagination (about 6 MB for 310 postings). A posting's full text is its
// description (opening and body), its lists (each a heading and <li>
// items) and its additional section. The API returns no company name, so
// the source is configured with one. No salaryRange appeared on the
// verified site, so salary is not mapped from Lever. The array is the whole
// site, so a complete run can show that a tracked posting is gone (feature
// 13); the configured company name is display-only, not retrieval scope.

const configSchema = z.object({ site: slugSchema, company: companyNameSchema }).strict();
type LeverConfig = z.infer<typeof configSchema>;

const postingSchema = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    hostedUrl: z.string().nullish(),
    applyUrl: z.string().nullish(),
    createdAt: z.number().nullish(),
    workplaceType: z.string().nullish(),
    country: z.string().nullish(),
    categories: z
      .object({
        commitment: z.string().nullish(),
        location: z.string().nullish(),
        team: z.string().nullish(),
        department: z.string().nullish(),
        allLocations: z.array(z.string()).nullish(),
      })
      .passthrough()
      .nullish(),
    description: z.string().nullish(),
    lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() }).passthrough()).nullish(),
    additional: z.string().nullish(),
  })
  .passthrough();

const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// The posting as one HTML document: description, then each list under its
// heading, then the additional section.
export function leverPostingHtml(posting: z.infer<typeof postingSchema>): string {
  const lists = (posting.lists ?? [])
    .map((list) => `<h3>${escapeText(list.text ?? "")}</h3><ul>${list.content ?? ""}</ul>`)
    .join("");
  return `${posting.description ?? ""}${lists}${posting.additional ?? ""}`;
}

export const leverAdapter: SourceAdapter<LeverConfig> = {
  key: "lever",
  name: "Lever",
  retrievalType: "OFFICIAL_PUBLIC_API_FEED",
  sourceCategory: "ATS",
  sourceType: "ATS",
  configSchema,
  configFields: [
    { name: "site", label: "Site name", help: "From the employer's Lever job-board address, for example palantir in jobs.lever.co/palantir.", required: true },
    { name: "company", label: "Company name", help: "Lever does not return the employer's name, so it is taken from here.", required: true },
  ],
  requiredEnv: [],
  verified: true,
  attribution: null,
  verificationUrl: (config) => `https://api.lever.co/v0/postings/${encodeURIComponent(config.site)}?mode=json`,
  listingCoverage: "complete-board",
  trackingScope: (config) => ({ site: config.site }),
  async collect(context, config) {
    let coverage: ListingCoverage | undefined;
    const result = await collectPages(context, async () => {
      const url = leverAdapter.verificationUrl(config);
      const response = parseResponse(z.array(z.unknown()), await getJson(context.transport, url), url);
      coverage = listingCoverage(
        response.map((posting) => itemId(z.object({ id: z.string() }).passthrough(), posting, (value) => value.id)),
        { readWholeListing: true },
      );
      const { valid, issues } = parseItems(postingSchema, response);
      const mapped = mapKeptItems(leverAdapter, context, valid, {
        title: (posting) => posting.text,
        externalId: (posting) => posting.id,
        map: (posting) => ({
          externalId: posting.id,
          title: posting.text,
          company: config.company,
          location: posting.categories?.location ?? null,
          description: htmlToText(leverPostingHtml(posting)),
          employmentType: posting.categories?.commitment ?? null,
          postingDate: isoDate(posting.createdAt),
          sourceUrl: posting.hostedUrl ?? null,
          applicationUrl: posting.applyUrl ?? posting.hostedUrl ?? null,
          structured: { workplaceType: workplaceType(posting.workplaceType) },
          material: {
            team: posting.categories?.team ?? null,
            department: posting.categories?.department ?? null,
            allLocations: posting.categories?.allLocations ?? [],
          },
          metadata: {
            site: config.site,
            companySource: "configured",
            country: posting.country ?? null,
            team: posting.categories?.team ?? null,
            department: posting.categories?.department ?? null,
            allLocations: posting.categories?.allLocations ?? [],
            workplaceType: posting.workplaceType ?? null,
          },
          sourceItem: posting,
        }),
      });
      return { listings: mapped.listings, issues: [...issues, ...mapped.issues], fetched: response.length, more: false };
    });
    return coverage ? { ...result, coverage } : result;
  },
};
