import Link from "next/link";
import { ManualOpportunityForm } from "@/components/manual-opportunity-form";

export default function NewOpportunityPage() {
  return (
    <main>
      <Link href="/">← All opportunities</Link>
      <h1>New opportunity</h1>
      <p>
        Enter raw opportunity text. The platform preserves the source before
        creating a normalized, traceable Opportunity record.
      </p>
      <ManualOpportunityForm />
    </main>
  );
}
