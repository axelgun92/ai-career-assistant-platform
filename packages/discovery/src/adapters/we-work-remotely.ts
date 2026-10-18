import { htmlToText } from "@ai-career/normalization";
import { z } from "zod";
import { collectPages, mapKeptItems } from "../collection";
import { AdapterError, type SourceAdapter } from "../contract";
import { parseRssItems, RssParseError, rssField, type RssItem } from "../rss";
import { getText } from "../transport";
import { isoDate, slugSchema } from "./shared";

// We Work Remotely category RSS feed (job board, official public feed).
// Verified October 17, 2026 against the remote-customer-support-jobs
// category: RSS 2.0 items with title "Company: Job title", region, country,
// state, skills, category, type, pubDate, expires_at, guid and link (the
// listing URL, also its identity) and an HTML description; no pagination.

const configSchema = z.object({ category: slugSchema.default("remote-customer-support-jobs") }).strict();
type WeWorkRemotelyConfig = z.infer<typeof configSchema>;

// "Company: Job title"; a title without the separator has no company.
export function splitWwrTitle(value: string): { company: string | null; title: string } {
  const index = value.indexOf(": ");
  return index > 0 ? { company: value.slice(0, index).trim(), title: value.slice(index + 2).trim() } : { company: null, title: value.trim() };
}

const location = (item: RssItem) =>
  [rssField(item, "region"), rssField(item, "state"), rssField(item, "country")].filter(Boolean).join(", ") || null;

export const weWorkRemotelyAdapter: SourceAdapter<WeWorkRemotelyConfig> = {
  key: "we-work-remotely",
  name: "We Work Remotely",
  retrievalType: "OFFICIAL_PUBLIC_API_FEED",
  sourceCategory: "JOB_BOARD",
  sourceType: "API",
  configSchema,
  configFields: [
    { name: "category", label: "Category feed", help: "Defaults to remote-customer-support-jobs (verified).", required: false },
  ],
  requiredEnv: [],
  verified: true,
  attribution: null,
  verificationUrl: (config) => `https://weworkremotely.com/categories/${encodeURIComponent(config.category)}.rss`,
  collect(context, config) {
    return collectPages(context, async () => {
      const url = weWorkRemotelyAdapter.verificationUrl(config);
      const body = await getText(context.transport, url, { accept: "application/rss+xml, application/xml;q=0.9" });
      let items: RssItem[];
      try {
        items = parseRssItems(body);
      } catch (error) {
        if (error instanceof RssParseError) throw new AdapterError("CONTRACT_MISMATCH", "The feed is not valid RSS", { url });
        throw error;
      }
      const mapped = mapKeptItems(weWorkRemotelyAdapter, context, items, {
        title: (item) => splitWwrTitle(rssField(item, "title") ?? "").title || null,
        externalId: (item) => rssField(item, "guid") ?? rssField(item, "link"),
        map: (item) => {
          const { company, title } = splitWwrTitle(rssField(item, "title") ?? "");
          return {
            externalId: rssField(item, "guid") ?? rssField(item, "link"),
            title,
            company,
            location: location(item),
            description: htmlToText(rssField(item, "description")),
            employmentType: rssField(item, "type"),
            postingDate: isoDate(rssField(item, "pubDate")),
            sourceUrl: rssField(item, "link"),
            applicationUrl: rssField(item, "link"),
            material: { skills: rssField(item, "skills"), category: rssField(item, "category") },
            metadata: {
              feedCategory: config.category,
              category: rssField(item, "category"),
              region: rssField(item, "region"),
              country: rssField(item, "country"),
              state: rssField(item, "state"),
              skills: rssField(item, "skills"),
              expiresAt: isoDate(rssField(item, "expires_at")),
            },
            sourceItem: item.fields,
          };
        },
      });
      return { ...mapped, fetched: items.length, more: false };
    });
  },
};
