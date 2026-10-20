import { connection } from "next/server";
import { PrismaExtensionPairingRepository } from "@ai-career/database";
import { PairingsManager, type PairingView } from "@/components/extension/pairings-manager";
import { pairingView } from "@/server/extension-api";

export const metadata = { title: "Browser extension" };

export default async function ExtensionPage() {
  await connection();
  let pairings: PairingView[];
  try {
    pairings = (await new PrismaExtensionPairingRepository().list()).map(pairingView);
  } catch (error) {
    console.error("Extension page could not load", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <main className="sources-page">
        <h1>Browser extension</h1>
        <p className="error-message" role="alert">
          The paired browsers could not be loaded. Check the database connection and try again.
        </p>
      </main>
    );
  }

  return (
    <main className="sources-page">
      <h1>Browser extension</h1>
      <p>
        The browser extension saves the job page you are viewing, when you ask it to, into AI Job Assistant. It reads
        only that one page&apos;s job posting, never other tabs, your browsing history, cookies or account pages. A saved
        job arrives unevaluated, like any other source; evaluating it stays your choice, within your budget.
      </p>
      <p className="muted">
        Build it with <code>pnpm extension:build</code> and load <code>apps/extension/dist</code> as an unpacked
        extension in Chrome (<code>chrome://extensions</code>, Developer mode). Then pair it here.
      </p>
      <PairingsManager pairings={pairings} />
    </main>
  );
}
