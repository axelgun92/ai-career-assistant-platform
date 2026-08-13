import { platformMetadata } from "@ai-career/core";
import { ManualOpportunityForm } from "@/components/manual-opportunity-form";

export default function HomePage() {
  return (
    <main>
      <h1>{platformMetadata.name}</h1>
      <p>
        Enter raw opportunity text. The platform preserves the source before
        creating a normalized, traceable Opportunity record.
      </p>
      <ManualOpportunityForm />
    </main>
  );
}
