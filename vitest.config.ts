import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
  },
  resolve: {
    alias: {
      // The web app's own import alias (apps/web/tsconfig.json "@/*"), so
      // route handlers can be unit-tested.
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
      "@ai-career/browser-retrieval": fileURLToPath(
        new URL("./packages/browser-retrieval/src/index.ts", import.meta.url),
      ),
      "@ai-career/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
      "@ai-career/customer-success": fileURLToPath(
        new URL("./domains/customer-success/src/index.ts", import.meta.url),
      ),
      "@ai-career/database": fileURLToPath(
        new URL("./database/src/index.ts", import.meta.url),
      ),
      "@ai-career/deduplication": fileURLToPath(
        new URL("./packages/deduplication/src/index.ts", import.meta.url),
      ),
      "@ai-career/discovery": fileURLToPath(
        new URL("./packages/discovery/src/index.ts", import.meta.url),
      ),
      "@ai-career/evaluation": fileURLToPath(
        new URL("./packages/evaluation/src/index.ts", import.meta.url),
      ),
      "@ai-career/evidence": fileURLToPath(
        new URL("./packages/evidence/src/index.ts", import.meta.url),
      ),
      "@ai-career/normalization": fileURLToPath(
        new URL("./packages/normalization/src/index.ts", import.meta.url),
      ),
      "@ai-career/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
  },
});
