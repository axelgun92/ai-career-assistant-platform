import Link from "next/link";
import { connection } from "next/server";
import { platformMetadata } from "@ai-career/core";
import type { OpportunityListItem } from "@ai-career/database";
import { OpportunityList } from "@/components/dashboard/opportunity-list";
import { getOpportunityListReader } from "@/server/opportunity-list-service";

export default async function HomePage() {
  await connection();
  let opportunities: OpportunityListItem[] | null = null;
  try {
    opportunities = await getOpportunityListReader().listOpportunities();
  } catch (error) {
    console.error("Opportunity dashboard could not load opportunities", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>{platformMetadata.name}</h1>
          <p>Opportunities you have added, newest first, with their latest persisted evaluation.</p>
        </div>
        <Link href="/opportunities/new" className="button-link">
          New opportunity
        </Link>
      </div>

      <section aria-labelledby="opportunities-title">
        <h2 id="opportunities-title">Opportunities</h2>
        {opportunities === null ? (
          <p className="error-message" role="alert">
            Opportunities could not be loaded. Check the database connection and try again.
          </p>
        ) : (
          <OpportunityList opportunities={opportunities} />
        )}
      </section>
    </main>
  );
}
