// D1 (approved November 8, 2026): the three events a re-read of a saved job
// can be — an unchanged observation, a normalization correction of the same
// posting, a changed posting — kept distinct in the capture result, the Mode B
// refresh status, the popup, the recorded correction events and the job
// page's evaluation hint. Nothing here re-evaluates anything.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { correctedFactLabels, normalizationCorrectionsOf, pageCaptureIncompleteRefreshes, reobservationEvent } from "@ai-career/core";
import { captureMessage } from "../../apps/extension/src/popup-view";
import type { CaptureResponse } from "../../apps/extension/src/api";
import { ListingVersionHint } from "../../apps/web/src/components/evaluation/listing-version-hint";
import { refreshText } from "../../apps/web/src/components/extension/page-capture-labels";

describe("the three re-observation events", () => {
  it("are told apart from the ingestion result", () => {
    expect(reobservationEvent({ outcome: "UNCHANGED" })).toBe("UNCHANGED_OBSERVATION");
    expect(reobservationEvent({ outcome: "UNCHANGED", normalizationCorrected: [] })).toBe("UNCHANGED_OBSERVATION");
    expect(reobservationEvent({ outcome: "UNCHANGED", normalizationCorrected: ["compensationBasis", "salaryText"] })).toBe("NORMALIZATION_CORRECTION");
    expect(reobservationEvent({ outcome: "CHANGED" })).toBe("SOURCE_CONTENT_CHANGE");
    expect(reobservationEvent({ outcome: "CREATED" })).toBeNull();
    expect(reobservationEvent({ outcome: "ATTACHED" })).toBeNull();
  });

  it("name the corrected facts as the product does, once per fact group", () => {
    expect(correctedFactLabels(["compensationBasis", "salaryText", "remoteStatus", "workArrangements", "residencyExclusions", "applicationUrl"])).toEqual([
      "Salary",
      "Work arrangement",
      "Residency",
      "Application link",
    ]);
    expect(correctedFactLabels(undefined)).toEqual([]);
  });

  it("read the recorded correction events, ignoring anything not in their shape", () => {
    const metadata = {
      capture: { readerRevision: 1 },
      normalizationCorrections: [{ at: "2026-11-08T11:00:00.000Z", observedAt: "2026-11-08T11:00:00.000Z", readerRevision: 1, fields: ["closingDate"] }, { at: "not a date", fields: [] }, "junk"],
    };
    expect(normalizationCorrectionsOf(metadata)).toEqual([{ at: new Date("2026-11-08T11:00:00.000Z"), fields: ["closingDate"] }]);
    expect(normalizationCorrectionsOf(null)).toEqual([]);
    expect(normalizationCorrectionsOf({ normalizationCorrections: "x" })).toEqual([]);
  });
});

describe("as shown", () => {
  const capture = (outcome: CaptureResponse["outcome"], normalizationCorrected?: string[]): CaptureResponse => ({
    outcome,
    ...(normalizationCorrected ? { normalizationCorrected } : {}),
    decision: null,
    opportunityId: "0b7f2f5e-5c3a-4a63-8d9e-2f4c7f0c9a22",
    opportunityUrl: "/opportunities/0b7f2f5e-5c3a-4a63-8d9e-2f4c7f0c9a22",
    site: { host: "linkedin.com", name: "LinkedIn", knownHost: true },
    sourceCategory: "JOB_BOARD",
    probableDuplicate: false,
    outsideRoleFamilies: false,
    evaluation: null,
  });

  it("Single Capture says which event it was", () => {
    expect(captureMessage(capture("UNCHANGED"))).toBe("Already saved. Nothing changed.");
    expect(captureMessage(capture("UNCHANGED", ["Salary", "Work arrangement"]))).toBe(
      "Already saved. The posting has not changed; its saved details were corrected by the current reading rules (Salary, Work arrangement). No new version was recorded.",
    );
    expect(captureMessage(capture("CHANGED"))).toBe("Already saved. The posting changed, so the new version was recorded.");
  });

  it("a Mode B refresh says which event it was, and the refresh state stays countable", () => {
    expect(refreshText("REFRESHED:UNCHANGED:0")).toBe("Read again: no change");
    expect(refreshText("REFRESHED:CORRECTED:0")).toBe("Read again: the posting is unchanged; saved details corrected by the current reading rules");
    expect(refreshText("REFRESHED:CHANGED:0")).toBe("Updated from a new read");
    expect(pageCaptureIncompleteRefreshes("REFRESHED:CORRECTED:2")).toBe(2);
  });

  it("the job page notes an evaluation made before a correction (informational; nothing is reevaluated)", () => {
    const text = renderToStaticMarkup(
      <ListingVersionHint
        hint={{
          evaluatedAt: new Date("2026-11-07T10:00:00.000Z"),
          evaluatedVersionSeenAt: new Date("2026-11-05T20:15:29.000Z"),
          currentVersionSeenAt: new Date("2026-11-05T20:15:29.000Z"),
          correctedAt: new Date("2026-11-08T11:00:00.000Z"),
          correctedFacts: ["Salary"],
        }}
      />,
    ).replace(/<[^>]+>/g, "");
    expect(text).toContain("The latest evaluation was made before the saved details were corrected on 2026-11-08 by the current reading rules (Salary).");
    expect(text).toContain("The posting itself has not changed.");
    expect(text).toContain("the earlier evaluation is kept");
  });
});
