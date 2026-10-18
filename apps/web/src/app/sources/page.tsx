import { connection } from "next/server";
import { SourcesManager } from "@/components/sources/sources-manager";
import type { RunView, SourceView } from "@/components/sources/types";
import type { RetrievalRunRecord } from "@ai-career/database";
import { getRetrievalService } from "@/server/retrieval-service";

export const metadata = { title: "Sources" };

const recentRuns = 5;

function runView(run: RetrievalRunRecord): RunView {
  return {
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    counts: run.counts,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
  };
}

export default async function SourcesPage() {
  await connection();
  const service = getRetrievalService();
  let sources: SourceView[];
  try {
    const listed = await service.list({ includeArchived: true });
    sources = [];
    // Sequential reads keep connection use flat.
    for (const source of listed) {
      const runs = await service.runs(source.id);
      sources.push({
        id: source.id,
        adapterKey: source.adapterKey,
        adapterName: source.adapter?.name ?? source.adapterKey,
        name: source.name,
        retrievalType: source.retrievalType,
        sourceCategory: source.sourceCategory,
        enabled: source.enabled,
        config: (source.config ?? {}) as Record<string, unknown>,
        scheduleMinutes: source.scheduleMinutes,
        lastRunAt: source.lastRunAt?.toISOString() ?? null,
        archivedAt: source.archivedAt?.toISOString() ?? null,
        enableBlockedReason: source.enableBlockedReason,
        configFields: [...(source.adapter?.configFields ?? [])],
        runs: runs.slice(0, recentRuns).map(runView),
      });
    }
  } catch (error) {
    console.error("Sources page could not load", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <main className="sources-page">
        <h1>Sources</h1>
        <p className="error-message" role="alert">
          The sources could not be loaded. Check the database connection and try again.
        </p>
      </main>
    );
  }

  return (
    <main className="sources-page">
      <h1>Sources</h1>
      <p>
        Automated discovery collects listings from the sources you add here and enable. Only listings whose title
        matches a Customer Success role family are kept. Retrieved opportunities arrive unevaluated; evaluating one
        stays your choice, within your budget.
      </p>
      <p className="muted">
        Sources are disabled when added and run on their schedule only after you enable them. The retrieval worker
        (<code>pnpm worker:retrieval</code>) runs them; Run now queues a run for it.
      </p>
      <SourcesManager
        sources={sources}
        adapters={service.adapters().map((adapter) => ({ ...adapter, configFields: [...adapter.configFields] }))}
      />
    </main>
  );
}
