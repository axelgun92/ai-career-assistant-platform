import {
  extensionCaptureSchema,
  extensionCaptureSchemaVersion,
  extensionEditableFieldValues,
  type ExtensionCapture,
  type ExtensionEditableField,
} from "../../../packages/core/src/extension-capture";
import type { ExtractedPosting, PageExtraction, PageExtractor } from "./extract";

// The capture envelope sent to Core, checked locally with the same schema
// the server applies. The server checks it again and decides everything
// else (site, category, listing identity, duplicates).

export type CaptureChoice = "page" | "selection";

// What the user sees in the preview, and may correct, before saving.
export type PreviewFields = Record<ExtensionEditableField, string | null>;

export type EnvelopeResult = { ok: true; envelope: ExtensionCapture } | { ok: false; problems: string[] };

const fieldNames: Record<string, string> = {
  "fields.title": "the job title",
  "fields.description": "the job description",
};

// The fields the preview starts with for a choice: what was read, with no
// value filled in where the page stated none.
export function previewFields(extraction: PageExtraction, choice: CaptureChoice): PreviewFields | null {
  if (choice === "selection") {
    if (!extraction.selection) return null;
    return {
      title: extraction.selection.title,
      company: extraction.posting?.company ?? null,
      location: extraction.posting?.location ?? null,
      description: extraction.selection.description,
    };
  }
  if (!extraction.posting) return null;
  const { title, company, location, description } = extraction.posting;
  return { title, company, location, description };
}

export function buildCaptureEnvelope(
  extraction: PageExtraction,
  choice: CaptureChoice,
  context: { extensionVersion: string; capturedAt: Date },
  // The preview's values as the user left them; omitted, the fields are
  // sent as read.
  edited?: Partial<PreviewFields>,
): EnvelopeResult {
  let extractor: PageExtractor;
  let posting: ExtractedPosting;
  if (choice === "selection") {
    if (!extraction.selection) return { ok: false, problems: ["No text is selected on the page"] };
    extractor = "selection";
    posting = {
      title: extraction.selection.title,
      description: extraction.selection.description,
      company: extraction.posting?.company ?? null,
      location: extraction.posting?.location ?? null,
      salaryText: null,
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
      workplaceType: null,
      employmentType: null,
      postedAt: null,
      applicationUrl: null,
      siteJobId: extraction.posting?.siteJobId ?? null,
    };
  } else {
    if (!extraction.posting || !extraction.extractor) return { ok: false, problems: ["No job posting was found on this page"] };
    extractor = extraction.extractor;
    posting = extraction.posting;
  }
  // Apply the user's corrections; a cleared field is sent as unknown.
  const read = previewFields(extraction, choice);
  const editedFields: ExtensionEditableField[] = [];
  if (edited && read) {
    for (const field of extensionEditableFieldValues) {
      if (edited[field] === undefined) continue;
      const value = edited[field]?.trim() ? edited[field]!.trim() : null;
      if (value !== (read[field]?.trim() || null)) {
        editedFields.push(field);
        posting = { ...posting, [field]: value };
      }
    }
  }
  const envelope = {
    schemaVersion: extensionCaptureSchemaVersion,
    pageUrl: extraction.pageUrl,
    extractor,
    capturedAt: context.capturedAt.toISOString(),
    extensionVersion: context.extensionVersion,
    fields: posting,
    notes: extraction.notes.slice(0, 5),
    editedFields,
  };
  const parsed = extensionCaptureSchema.safeParse(envelope);
  if (!parsed.success) {
    return {
      ok: false,
      problems: [
        ...new Set(
          parsed.error.issues.map((issue) => {
            const path = issue.path.join(".");
            return fieldNames[path] ? `Missing or too long: ${fieldNames[path]}` : `Invalid ${path || "capture"}`;
          }),
        ),
      ],
    };
  }
  return { ok: true, envelope: parsed.data };
}
