import { getProfileApiHandlers } from "@/server/profile-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return getProfileApiHandlers().getVersion(id);
}
