import { connection } from "next/server";
import { PersonalQueryError, type PersonalAnalytics } from "@ai-career/core";
import { MySearchControls, MySearchView, parseRoleSort } from "@/components/my-search/my-search";
import { getPersonalAnalyticsService, personalQueryKeys, type PersonalQueryInput } from "@/server/personal-analytics-service";

export const metadata = { title: "My search" };

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

// Personal Job-Search Analytics (feature 17): what is actually working in your
// own job search, from your evaluations and applications. Descriptive only:
// nothing here evaluates, scores roles or measures evaluator accuracy.
export default async function MySearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  await connection();
  const params = await searchParams;
  const query: PersonalQueryInput = Object.fromEntries(personalQueryKeys.map((key) => [key, one(params[key])]));
  const roleSort = parseRoleSort(one(params.roleSort));
  let personal: PersonalAnalytics;
  try {
    personal = await getPersonalAnalyticsService().analytics(query);
  } catch (error) {
    const invalid = error instanceof PersonalQueryError;
    if (!invalid) console.error("My search could not load", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <main className="sources-page">
        <h1>My search</h1>
        <p className="error-message" role="alert">
          {invalid ? `${error.message}. ` : "My search could not be loaded. Check the database connection and try again. "}
          <a href="/my-search">Show all time</a>
        </p>
      </main>
    );
  }
  return (
    <main className="sources-page">
      <h1>My search</h1>
      <p>
        What is working in your own job search, from what actually happened: your applications and their interviews and offers, what the evaluator said
        about the jobs, the gaps it found against your profile, and the sources and kinds of roles behind them. Every figure shows its count; nothing here
        scores roles or measures how accurate the evaluator is.
      </p>
      <MySearchControls personal={personal} roleSort={roleSort} />
      <MySearchView personal={personal} roleSort={roleSort} />
    </main>
  );
}
