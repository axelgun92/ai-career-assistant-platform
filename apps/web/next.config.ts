import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

config({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});

const nextConfig: NextConfig = {
  transpilePackages: [
    "@ai-career/core",
    "@ai-career/database",
    "@ai-career/normalization",
    "@ai-career/shared",
  ],
};

export default nextConfig;
