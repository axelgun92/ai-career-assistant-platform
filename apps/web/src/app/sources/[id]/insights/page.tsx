import Link from "next/link";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { SourceInsightsWindowError } from "@ai-career/core";
import { SourceInsightDetailView, SourcesSectionNav } from "@/components/sources/source-insights";
import { getSourceInsightsService, SourceInsightsNotFoundError } from "@/server/source-intelligence-service";

export const metadata = { title: "Source insights" };

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

// One source's Source Intelligence drill-down (feature 15).
export default async function SourceInsightPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  await connection();
  const { id } = await params;
  const query = await searchParams;
  let detail: Awaited<ReturnType<ReturnType<typeof getSourceInsightsService>["detail"]>>;
  try {
    detail = await getSourceInsightsService().detail(decodeURIComponent(id), { window: one(query.window), from: one(query.from), to: one(query.to) });
  } catch (error) {
    if (error instanceof SourceInsightsNotFoundError) notFound();
    const invalid = error instanceof SourceInsightsWindowError;
    if (!invalid) console.error("Source insight could not load", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <main className="sources-page">
        <h1>Source insights</h1>
        <SourcesSectionNav current="insights" />
        <p className="error-message" role="alert">
          {invalid ? `${error.message}. ` : "This source's insights could not be loaded. "}
          <Link href="/sources/insights">Back to source insights</Link>
        </p>
      </main>
    );
  }
  return (
    <main className="sources-page">
      <h1>{detail.source.name}</h1>
      <SourcesSectionNav current="insights" />
      <p>
        <Link href="/sources/insights">All source insights</Link>
      </p>
      <SourceInsightDetailView detail={detail} />
    </main>
  );
}
