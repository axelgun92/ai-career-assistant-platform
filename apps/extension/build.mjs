// Builds the unpacked extension into apps/extension/dist: the popup and
// options scripts bundled with esbuild (the capture schema and zod
// included), plus the static manifest, pages and styles. Load dist in
// Chrome with "Load unpacked". Nothing is fetched; no secrets are bundled.
import { build } from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await build({
  entryPoints: {
    popup: join(root, "src/popup.ts"),
    options: join(root, "src/options.ts"),
    "service-worker": join(root, "src/service-worker.ts"),
  },
  outdir: dist,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  // Readable output: the page reader is serialized from this bundle, and the
  // built files are meant to be reviewable.
  minify: false,
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
});
await cp(join(root, "static"), dist, { recursive: true });

const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
console.log(`Built AI Job Assistant Companion ${manifest.version} into ${dist}`);
