import { connection } from "next/server";
import { MarketQueryError, type MarketAnalytics } from "@ai-career/core";
import { MarketControls, MarketView } from "@/components/market/market-analytics";
import { getMarketAnalyticsService, marketQueryKeys, type MarketQueryInput } from "@/server/market-analytics-service";

export const metadata = { title: "Market" };

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

// Job-Market Analytics (feature 16): what the collected market looks like,
// from the recorded history. Evidence only; nothing here evaluates, ranks
// sources or companies, or changes a job.
export default async function MarketPage({ searchParams }: { searchParams: Promise<Params> }) {
  await connection();
  const params = await searchParams;
  const query: MarketQueryInput = Object.fromEntries(marketQueryKeys.map((key) => [key, one(params[key])]));
  let market: MarketAnalytics;
  try {
    market = await getMarketAnalyticsService().analytics(query);
  } catch (error) {
    const invalid = error instanceof MarketQueryError;
    if (!invalid) console.error("Market analytics could not load", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <main className="sources-page">
        <h1>Market</h1>
        <p className="error-message" role="alert">
          {invalid ? `${error.message}. ` : "Market analytics could not be loaded. Check the database connection and try again. "}
          <a href="/market">Show the last 30 days</a>
        </p>
      </main>
    );
  }
  return (
    <main className="sources-page">
      <h1>Market</h1>
      <p>
        What the collected job market looks like, from what was actually collected: salaries, titles, locations and work arrangements, seniority,
        requirements, customer segments and recommendations. Each job counts once, by the date it was first seen. Every figure shows its count; under 5
        is labelled insufficient sample and 5 to 19 a small sample. Unknown means the posting did not say.
      </p>
      <MarketControls market={market} />
      <MarketView market={market} />
    </main>
  );
}
