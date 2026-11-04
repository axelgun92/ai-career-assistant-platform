// Regression for the first local LinkedIn P1 run, which stopped with
// "ReferenceError: __name is not defined" inside the evaluated single-job
// reader. tsx (the runtime of `pnpm page-capture:verify` and
// `pnpm worker:retrieval`) compiles with esbuild's keepNames, so the reader's
// serialized source calls a module-scope `__name` helper that the evaluated
// copy does not have. Vitest does not compile that way, so this test runs the
// real P1 path in a tsx child process (tests/support/p1-runtime-harness.ts,
// with a fake browser: no network, browser or database) and checks that:
// - the serialized reader there really carries `__name(` calls;
// - the P1 experiment reads the pages and gives PASS;
// - the reader's output under tsx equals its output here for the same pages,
//   so the accepted extraction is unchanged.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { readJobPage } from "../../apps/web/src/server/page-capture-acquisition";
import { p1RuntimeFixtures } from "../support/p1-runtime-fixtures";

const root = path.resolve(__dirname, "../..");

describe("the P1 reader path under the tsx runtime", () => {
  it("evaluates the unchanged reader despite tsx's __name helper calls and gives the same extraction as here", () => {
    const run = spawnSync(process.execPath, [
      path.join(root, "node_modules/tsx/dist/cli.mjs"),
      path.join(root, "tests/support/p1-runtime-harness.ts"),
    ], {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, RETRIEVAL_BROWSER_EXECUTABLE: "" },
    });
    expect(run.status, (run.stderr ?? run.error?.message ?? "").slice(0, 2_000)).toBe(0);
    const output = JSON.parse(run.stdout.trim().split("\n").pop()!) as {
      readerHasNameHelper: boolean;
      verification: { verdict: string; readable: number; pages: Array<{ result: string; extractor: string | null; openedUrl: string }> };
      extractions: Array<{ name: string; extraction: unknown }>;
    };

    // The condition that broke the local run is present in this runtime.
    expect(output.readerHasNameHelper).toBe(true);

    // The P1 path itself: canonical URLs, readable postings, PASS.
    expect(output.verification).toMatchObject({ verdict: "PASS", readable: 2 });
    expect(output.verification.pages.map((page) => [page.openedUrl, page.result, page.extractor])).toEqual([
      ["https://www.linkedin.com/jobs/view/4423511448", "READABLE", "structured-data"],
      ["https://www.linkedin.com/jobs/view/4486498409", "READABLE", "structured-data"],
    ]);

    // Same reader, same pages, same result under both compilations.
    for (const fixture of p1RuntimeFixtures) {
      const here = readJobPage(new JSDOM(fixture.html, { url: fixture.url, runScripts: "outside-only" }).window.document);
      const there = output.extractions.find((item) => item.name === fixture.name)!.extraction;
      expect(there, fixture.name).toEqual(here);
      expect((here as { posting: unknown } | null)?.posting, fixture.name).toBeTruthy();
    }
  }, 150_000);
});
