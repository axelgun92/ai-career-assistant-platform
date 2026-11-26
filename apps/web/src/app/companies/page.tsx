import Link from "next/link";
import { connection } from "next/server";
import { CompanyQueryError, type CompanyIndex } from "@ai-career/core";
import { CompanyIndexControls, CompanyIndexView } from "@/components/companies/companies";
import { companyIndexQueryKeys, getCompanyIntelligenceService, type CompanyIndexInput } from "@/server/company-intelligence-service";

export const metadata = { title: "Companies" };

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

// Company Intelligence (feature 18): what has been observed about each
// company, from the collected listings and your own applications. Factual
// only: no company is scored, ranked by quality or labelled.
export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Params> }) {
  await connection();
  const params = await searchParams;
  const query: CompanyIndexInput = Object.fromEntries(companyIndexQueryKeys.map((key) => [key, one(params[key])]));
  let index: CompanyIndex;
  try {
    index = await getCompanyIntelligenceService().index(query);
  } catch (error) {
    const invalid = error instanceof CompanyQueryError;
    if (!invalid) console.error("Companies could not load", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <main className="sources-page">
        <h1>Companies</h1>
        <p className="error-message" role="alert">
          {invalid ? `${error.message}. ` : "Companies could not be loaded. Check the database connection and try again. "}
          <Link href="/companies">Show all companies</Link>
        </p>
      </main>
    );
  }
  return (
    <main className="sources-page">
      <h1>Companies</h1>
      <p>
        What has been observed about each company over time: the roles your sources collected, which are still listed, roles that recur or were listed
        again, how they are offered, and your own applications there. Every figure is a count of what was observed; nothing here scores or ranks a company.
      </p>
      <CompanyIndexControls index={index} />
      <CompanyIndexView index={index} />
    </main>
  );
}
