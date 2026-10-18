import { adzunaAdapter } from "./adapters/adzuna";
import { ashbyAdapter } from "./adapters/ashby";
import { greenhouseAdapter } from "./adapters/greenhouse";
import { himalayasAdapter } from "./adapters/himalayas";
import { leverAdapter } from "./adapters/lever";
import { remoteOkAdapter } from "./adapters/remote-ok";
import { smartRecruitersAdapter } from "./adapters/smartrecruiters";
import { weWorkRemotelyAdapter } from "./adapters/we-work-remotely";
import { welcomeToTheJungleAdapter } from "./adapters/welcome-to-the-jungle";
import { wellfoundAdapter } from "./adapters/wellfound";
import { workableAdapter } from "./adapters/workable";
import { workdayAdapter } from "./adapters/workday";
import { workingNomadsAdapter } from "./adapters/working-nomads";
import type { AnySourceAdapter } from "./contract";

// The source adapters the product knows. An adapter appears here only once
// its mapping exists; `verified` says whether it has been checked against a
// real response (an unverified adapter cannot be enabled).

export interface AdapterRegistry {
  get(key: string): AnySourceAdapter | undefined;
  list(): readonly AnySourceAdapter[];
}

export function createAdapterRegistry(adapters: readonly AnySourceAdapter[]): AdapterRegistry {
  const byKey = new Map(adapters.map((adapter) => [adapter.key, adapter]));
  if (byKey.size !== adapters.length) throw new Error("Source adapter keys must be unique");
  return {
    get: (key) => byKey.get(key),
    list: () => adapters,
  };
}

export const sourceAdapters: readonly AnySourceAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  smartRecruitersAdapter,
  remoteOkAdapter,
  weWorkRemotelyAdapter,
  himalayasAdapter,
  workingNomadsAdapter,
  workdayAdapter,
  workableAdapter,
  wellfoundAdapter,
  adzunaAdapter,
  welcomeToTheJungleAdapter,
];

export const defaultAdapterRegistry = createAdapterRegistry(sourceAdapters);

// Environment variables an adapter needs that are not set.
export function missingEnvironment(adapter: AnySourceAdapter, env: Readonly<Record<string, string | undefined>>): string[] {
  return adapter.requiredEnv.filter((name) => !env[name]?.trim());
}
