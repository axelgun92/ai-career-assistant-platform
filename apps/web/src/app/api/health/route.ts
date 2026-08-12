import { platformMetadata } from "@ai-career/core";

export function GET() {
  return Response.json({
    status: "ok",
    service: platformMetadata.id,
  });
}
