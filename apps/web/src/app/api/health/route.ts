import { connection } from "next/server";
import { platformMetadata } from "@ai-career/core";
import { getDatabaseClient } from "@ai-career/database";
import { aiConfigurationStatus } from "@/server/ai-configuration";

// Read-only liveness: the web app is up and can reach the database. Reports
// whether AI evaluation is configured, never configuration values.
export async function GET() {
  await connection();
  let database: "ok" | "unavailable" = "ok";
  try {
    await getDatabaseClient().$queryRaw`SELECT 1`;
  } catch {
    database = "unavailable";
  }
  const healthy = database === "ok";
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      service: platformMetadata.id,
      database,
      aiConfigured: aiConfigurationStatus().state === "configured",
    },
    { status: healthy ? 200 : 503 },
  );
}
