import { connection } from "next/server";
import { headers } from "next/headers";
import Link from "next/link";
import { PrismaExtensionPairingRepository, PrismaPageCaptureRepository } from "@ai-career/database";
import { ExtensionNav } from "@/components/extension/extension-nav";
import { PairingsManager, type PairingView } from "@/components/extension/pairings-manager";
import { pairingView } from "@/server/extension-api";
import { shippedExtensionVersion, supportedSites } from "@/server/extension-setup";

export const metadata = { title: "Setup & Connection" };

// Setup & Connection: the browser extension's installation, pairing,
// connection and supported capture modes. Only the extension is managed
// here; profile, evaluation and budget settings stay on their own pages.
export default async function ExtensionPage() {
  await connection();
  let pairings: PairingView[];
  let waiting = 0;
  try {
    pairings = (await new PrismaExtensionPairingRepository().list()).map(pairingView);
    const counts = await new PrismaPageCaptureRepository().statusCounts();
    waiting = (counts.QUEUED ?? 0) + (counts.ACQUIRING ?? 0) + (counts.AWAITING_DETAILS ?? 0);
  } catch (error) {
    console.error("Extension page could not load", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return (
      <main className="sources-page">
        <p className="eyebrow">Browser extension</p>
        <h1>Setup &amp; Connection</h1>
        <ExtensionNav current="setup" />
        <p className="error-message" role="alert">
          The paired browsers could not be loaded. Check the database connection and try again.
        </p>
      </main>
    );
  }
  const host = (await headers()).get("host");
  const appAddress = host ? `http://${host}` : null;
  const version = shippedExtensionVersion();
  const sites = supportedSites();

  return (
    <main className="sources-page">
      <p className="eyebrow">Browser extension</p>
      <h1>Setup &amp; Connection</h1>
      <ExtensionNav current="setup" />
      <p>
        The browser extension saves job pages into AI Job Assistant when you ask it to: one job at a time (<strong>Single Job</strong>), or the jobs
        already shown on a supported results page (<strong>Batch Capture</strong>). It reads only the page you give it, never other tabs, your
        browsing history or cookies. Everything it saved is in <Link href="/extension/jobs">Captured Jobs</Link>
        {waiting ? ` (${waiting} waiting for details)` : ""}.
      </p>

      <PairingsManager pairings={pairings} currentVersion={version} />

      <section aria-labelledby="troubleshooting-heading">
        <h2 id="troubleshooting-heading">Connection and troubleshooting</h2>
        <ul>
          <li>
            This app is running{appAddress ? (
              <>
                {" "}at <code>{appAddress}</code>: enter exactly this address in the extension&apos;s Options
              </>
            ) : null}
            . Saving in Options checks the connection and the pairing, and says which one fails.
          </li>
          <li>
            <strong>&quot;AI Job Assistant could not be reached&quot;</strong>: the app is not running, or the extension has another address. Start the app,
            check the address in Options, and save again.
          </li>
          <li>
            <strong>&quot;The pairing is no longer valid&quot;</strong>: its access was revoked, or the credential was replaced. Create a new pairing above and
            paste it into Options; nothing captured is lost.
          </li>
          <li>
            A pairing&apos;s <em>last used</em> time is the last time that browser&apos;s extension reached this app; it does not mean the browser is open
            now.
          </li>
          <li>
            In the side panel, &quot;click the AI Job Assistant button in the toolbar&quot; means the extension has no access to the page shown yet: one click on
            the toolbar button gives it access to that page. The extension asks for no wider access.
          </li>
        </ul>
      </section>

      <section aria-labelledby="install-heading">
        <h2 id="install-heading">Installation and updates</h2>
        <p>
          {version ? (
            <>
              This app ships the extension version <strong>{version}</strong>.{" "}
            </>
          ) : null}
          It is installed as an unpacked development build; Chrome does not update it by itself.
        </p>
        <ol>
          <li>
            Build it: <code>pnpm extension:build</code>.
          </li>
          <li>
            In Chrome, open <code>chrome://extensions</code>, turn on Developer mode, choose <strong>Load unpacked</strong> and select{" "}
            <code>apps/extension/dist</code>.
          </li>
          <li>Pin the AI Job Assistant button: it opens the side panel and gives it access to the page shown.</li>
          <li>To save jobs from Incognito windows, open the extension&apos;s Details and allow it in Incognito.</li>
          <li>
            After an update: build again, then press the extension&apos;s reload button in <code>chrome://extensions</code>. The pairing is kept.
          </li>
        </ol>
      </section>

      <section aria-labelledby="sites-heading">
        <h2 id="sites-heading">Supported sites and modes</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Single Job</th>
                <th scope="col">Batch Capture</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((row) => (
                <tr key={row.site}>
                  <td>{row.site}</td>
                  <td>{row.single}</td>
                  <td>{row.batch}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
