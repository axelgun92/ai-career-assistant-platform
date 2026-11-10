import { getApplicationApiHandlers } from "@/server/application-service";

export async function GET(request: Request) {
  return getApplicationApiHandlers().list(request);
}
