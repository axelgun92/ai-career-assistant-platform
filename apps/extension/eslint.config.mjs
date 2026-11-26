import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

// The repository's lint rules for the extension, which is not a Next.js
// app (no pages directory), and never its built output.
export default defineConfig([
  ...nextVitals,
  { rules: { "@next/next/no-html-link-for-pages": "off" } },
  globalIgnores(["dist/**"]),
]);
