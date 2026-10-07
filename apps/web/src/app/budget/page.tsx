import Link from "next/link";
import { connection } from "next/server";
import { BudgetCard } from "@/components/budget/budget-card";
import { BudgetSettingsForm } from "@/components/budget/budget-settings-form";
import { DeferredBacklog } from "@/components/budget/deferred-backlog";
import { toDeferralView } from "@/components/budget/deferral-view";
import { formatDateTime } from "@/components/budget/budget-format";
import type { BudgetStatusView, DeferralView } from "@/components/budget/types";
import { getBudgetService } from "@/server/budget-service";
import { getProfileService } from "@/server/profile-service";

export const metadata = { title: "Budget" };
import { semanticExecutorConfigFromEnvironment } from "@/server/semantic-execution-config";

function pricingCurrency(): string {
  try {
    return semanticExecutorConfigFromEnvironment().pricing.currency;
  } catch {
    return "USD";
  }
}

export default async function BudgetPage() {
  await connection();
  const service = getBudgetService();
  let status: BudgetStatusView;
  let open: DeferralView[];
  let history: DeferralView[];
  try {
    status = await service.status();
    const all = await service.listDeferred();
    open = all.filter((item) => item.status === "DEFERRED").map(toDeferralView);
    history = all
      .filter((item) => item.status !== "DEFERRED")
      .sort((left, right) => (right.resumedAt ?? right.cancelledAt ?? right.createdAt).getTime() -
        (left.resumedAt ?? left.cancelledAt ?? left.createdAt).getTime())
      .slice(0, 20)
      .map(toDeferralView);
  } catch (error) {
    console.error("Budget page could not load", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return (
      <main className="budget-page">
        <h1>Budget &amp; deferred evaluations</h1>
        <p className="error-message" role="alert">
          The budget could not be loaded. Check the database connection and try again.
        </p>
      </main>
    );
  }
  const activeProfile = await getProfileService()
    .overview()
    .then(({ active }) => (active ? { id: active.userProfileId, version: active.version } : null))
    .catch(() => null);

  return (
    <main className="budget-page">
      <h1>Budget &amp; deferred evaluations</h1>
      <p>
        Track AI evaluation spend against a monthly budget. When the budget has no room, evaluations are deferred
        instead of started, and wait here until you resume them.
      </p>
      <BudgetCard status={status} />
      <BudgetSettingsForm status={status} defaultCurrency={pricingCurrency()} />
      <DeferredBacklog deferrals={open} activeProfile={activeProfile} />
      {history.length ? (
        <details className="source-details">
          <summary>Recently resumed or cancelled ({history.length})</summary>
          <ul className="provenance-list">
            {history.map((item) => (
              <li key={item.id}>
                <Link href={`/opportunities/${item.opportunityId}`}>{item.opportunityTitle ?? "Untitled opportunity"}</Link>
                {" — "}
                {item.status === "RESUMED"
                  ? `resumed ${formatDateTime(item.resumedAt)}`
                  : `cancelled ${formatDateTime(item.cancelledAt)}`}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </main>
  );
}
