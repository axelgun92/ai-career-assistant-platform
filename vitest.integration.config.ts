import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ai-career/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
      "@ai-career/database": fileURLToPath(
        new URL("./database/src/index.ts", import.meta.url),
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
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
