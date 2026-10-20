import { z } from "zod";

// The capture envelope the browser extension companion sends to Core
// (feature 14B, Core TDD §8). It carries only the job-posting fields the
// extension read from the one page the user asked it to read: never HTML,
// cookies, page scripts or other page content. The server parses it again
// with this same schema, so the extension's local check is structural only,
// and derives the host, source category and listing identity itself.
// Imports nothing but zod: the extension bundles this file.

export const extensionCaptureSchemaVersion = 1;
export const extensionCaptureMaxBytes = 128 * 1024;
export const extensionCaptureLimits = {
  url: 2048,
  title: 300,
  description: 50_000,
  shortText: 200,
  employmentType: 50,
  postedAt: 40,
  siteJobId: 100,
  notes: 5,
} as const;

export const extensionExtractorValues = ["structured-data", "site:linkedin", "selection", "main-content"] as const;
export type ExtensionExtractor = (typeof extensionExtractorValues)[number];

// Fields the user may correct in the extension's preview before saving. A
// corrected field is named in the capture, so its provenance shows it was
// edited by the user rather than read from the page.
export const extensionEditableFieldValues = ["title", "company", "location", "description"] as const;
export type ExtensionEditableField = (typeof extensionEditableFieldValues)[number];

// Control characters other than tab and newline, and the Unicode
// bidirectional overrides, never carry posting content.
// eslint-disable-next-line no-control-regex
const unsafeCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g;

// Captured text as plain, inert text: unsafe characters removed, runs of
// spaces collapsed and at most two consecutive line breaks kept.
export function cleanCapturedText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(unsafeCharacters, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Query parameters that only track how a page was reached (the same set the
// deduplication URL key ignores). Parameters that identify a listing are
// kept.
const trackingParameter = /^(utm_.+|gclid|fbclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi)$/i;

// The page URL without tracking parameters, credentials or a plain anchor;
// a fragment is kept only when it carries a route ("#/jobs/123"). Null when
// the value is not an http(s) URL.
export function cleanPageUrl(value: string): string | null {
  if (!isHttpUrl(value)) return null;
  const url = new URL(value);
  url.username = "";
  url.password = "";
  for (const name of [...url.searchParams.keys()]) {
    if (trackingParameter.test(name)) url.searchParams.delete(name);
  }
  if (!url.hash.includes("/")) url.hash = "";
  return url.toString();
}

export function isLinkedInHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "linkedin.com" || host.endsWith(".linkedin.com");
}

// The LinkedIn job ID of a job page: /jobs/view/<id> (optionally after a
// slug), or a jobs page showing one job (currentJobId=<id>). Null for any
// other LinkedIn page, which the extension does not read.
export function linkedInJobIdFromUrl(value: string): string | null {
  if (!isHttpUrl(value)) return null;
  const url = new URL(value);
  if (!isLinkedInHost(url.hostname)) return null;
  const view = /^\/jobs\/view\/(?:[^/]*-)?(\d{5,20})\/?$/.exec(url.pathname);
  if (view) return view[1]!;
  const current = url.searchParams.get("currentJobId");
  if (url.pathname.startsWith("/jobs/") && current && /^\d{5,20}$/.test(current)) return current;
  return null;
}

const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().default(null);
const httpUrl = z.string().trim().max(extensionCaptureLimits.url).refine(isHttpUrl, "Must be an http(s) URL");

export const extensionCaptureFieldsSchema = z
  .object({
    title: requiredText(extensionCaptureLimits.title),
    description: requiredText(extensionCaptureLimits.description),
    company: optionalText(extensionCaptureLimits.shortText),
    location: optionalText(extensionCaptureLimits.shortText),
    salaryText: optionalText(extensionCaptureLimits.shortText),
    salaryMin: z.number().finite().nonnegative().nullable().default(null),
    salaryMax: z.number().finite().nonnegative().nullable().default(null),
    salaryCurrency: z.string().trim().regex(/^[A-Za-z]{3}$/).nullable().default(null),
    salaryPeriod: z.enum(["YEAR", "MONTH", "WEEK", "DAY", "HOUR"]).nullable().default(null),
    workplaceType: z.enum(["REMOTE", "HYBRID", "ONSITE"]).nullable().default(null),
    employmentType: optionalText(extensionCaptureLimits.employmentType),
    postedAt: optionalText(extensionCaptureLimits.postedAt),
    applicationUrl: httpUrl.nullable().default(null),
    siteJobId: z.string().trim().min(1).max(extensionCaptureLimits.siteJobId).regex(/^\S+$/).nullable().default(null),
  })
  .strict();

export const extensionCaptureSchema = z
  .object({
    schemaVersion: z.literal(extensionCaptureSchemaVersion),
    pageUrl: httpUrl,
    extractor: z.enum(extensionExtractorValues),
    capturedAt: z.iso.datetime({ offset: true }),
    extensionVersion: z.string().regex(/^\d+(\.\d+){0,3}$/),
    fields: extensionCaptureFieldsSchema,
    notes: z.array(z.string().trim().min(1).max(extensionCaptureLimits.shortText)).max(extensionCaptureLimits.notes).default([]),
    editedFields: z
      .array(z.enum(extensionEditableFieldValues))
      .max(extensionEditableFieldValues.length)
      .refine((fields) => new Set(fields).size === fields.length, "Each field is named once")
      .default([]),
  })
  .strict();

export type ExtensionCaptureInput = z.input<typeof extensionCaptureSchema>;
export type ExtensionCapture = z.output<typeof extensionCaptureSchema>;
export type ExtensionCaptureFields = z.output<typeof extensionCaptureFieldsSchema>;
