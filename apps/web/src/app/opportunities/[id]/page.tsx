import Link from "next/link";
import { notFound } from "next/navigation";
import { getManualOpportunityService } from "@/server/manual-opportunity-service";
import { EvaluationExperience } from "@/components/evaluation/evaluation-experience";

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "Unknown";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getManualOpportunityService().getById(id).catch(() => null);

  if (!detail) {
    notFound();
  }

  const normalizedFields = [
    ["Lifecycle", detail.opportunity.status],
    ["Domain", detail.opportunity.domain],
    ["Title", detail.opportunity.title],
    ["Company", detail.opportunity.companyName],
    ["Location", detail.opportunity.location],
    ["Compensation", detail.opportunity.salaryText],
    ["Posting date", detail.opportunity.postingDate],
    ["Source URL", detail.opportunity.canonicalUrl],
    ["Application URL", detail.opportunity.applicationUrl],
    ["Remote status", detail.opportunity.remoteStatus],
    ["Time-zone requirements", detail.opportunity.timeZoneRequirements],
  ] as const;

  return (
    <main className="opportunity-page">
      <Link href="/">← Enter another opportunity</Link>

      <EvaluationExperience
        opportunity={{
          id: detail.opportunity.id,
          title: detail.opportunity.title ?? "Untitled opportunity",
          company: detail.opportunity.companyName ?? "Unknown company",
          salary: detail.opportunity.salaryText ?? "Unknown",
          location: detail.opportunity.location ?? "Unknown",
          workArrangement: detail.opportunity.remoteStatus ?? "Unknown",
          timeZoneRequirements: detail.opportunity.timeZoneRequirements ?? "Unknown",
        }}
      />

      <details className="source-details">
        <summary>Normalized opportunity and source details</summary>
      <section>
        <h2>Normalized Opportunity</h2>
        <dl>
          {normalizedFields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{display(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2>Preserved SourceRecord</h2>
        <p>
          SourceRecord ID: <code>{detail.sourceRecords[0]?.id}</code>
        </p>
        <pre>{detail.sourceRecords[0]?.rawDescription ?? "Unknown"}</pre>
      </section>

      <section>
        <h2>Field Provenance</h2>
        <ul className="provenance-list">
          {detail.fieldProvenance.map((item) => (
            <li key={item.id}>
              <strong>{item.fieldName}</strong>: {display(item.normalizedValue)}
              <br />
              <span>
                Source field: {item.sourceField}; method: {item.kind}
              </span>
            </li>
          ))}
        </ul>
      </section>
      </details>
    </main>
  );
}
