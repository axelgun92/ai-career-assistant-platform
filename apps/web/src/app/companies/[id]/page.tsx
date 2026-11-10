import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CompanyQueryError, type CompanyDetail } from "@ai-career/core";
import { CompanyDetailControls, CompanyDetailView } from "@/components/companies/companies";
import { companyDetailQueryKeys, getCompanyIntelligenceService, type CompanyDetailInput } from "@/server/company-intelligence-service";

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

export const metadata = { title: "Company" };

// Company Intelligence (feature 18): one company's observed postings, recurring
// roles, work arrangement and hiring regions, posting-history signals and your
// history with it. Factual only: nothing here rates the company.
export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Params> }) {
  await connection();
  const { id } = await params;
  const search = await searchParams;
  const query: CompanyDetailInput = Object.fromEntries(companyDetailQueryKeys.map((key) => [key, one(search[key])]));
  let detail: CompanyDetail | null;
  try {
    detail = await getCompanyIntelligenceService().detail(id, query);
  } catch (error) {
    const invalid = error instanceof CompanyQueryError;
    if (!invalid) console.error("Company could not load", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <main className="sources-page">
        <Link href="/companies">← All companies</Link>
        <h1>Company</h1>
        <p className="error-message" role="alert">
          {invalid ? `${error.message}. ` : "This company could not be loaded. Check the database connection and try again. "}
          <Link href={`/companies/${encodeURIComponent(id)}`}>Show all time</Link>
        </p>
      </main>
    );
  }
  if (!detail) notFound();
  return (
    <main className="sources-page">
      <Link href="/companies">← All companies</Link>
      <h1>{detail.company.name}</h1>
      <p>
        What has been observed about this company: roles your sources collected, how they were listed and offered, and your applications here. Counts
        only; nothing here rates the company. <Link href={`/?company=${encodeURIComponent(detail.company.key)}`}>Show its jobs on the dashboard</Link>.
      </p>
      <CompanyDetailControls detail={detail} />
      <CompanyDetailView detail={detail} />
    </main>
  );
}
