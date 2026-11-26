import { ManualOpportunityForm } from "@/components/manual-opportunity-form";

export const metadata = { title: "New opportunity" };

export default function NewOpportunityPage() {
  return (
    <main>
      <h1>New opportunity</h1>
      <p>
        Paste the job posting. The original text is kept as the source, and the
        opportunity appears on your dashboard ready to evaluate.
      </p>
      <ManualOpportunityForm />
    </main>
  );
}
