// The process-wide database client (November 25, 2026; hardened in review):
// a client is identified by a fingerprint of its complete generated metadata
// (embedded schema, runtime data model, parameterization schema, versions),
// so any generated-client change is detected, even one that keeps every
// model and field name; copies of one generation loaded by separate route
// bundles share one client; ordinary loading never replaces it; a replaced
// client is never disconnected (a transaction may still be open on it) and
// never kept, so repeated regeneration accumulates nothing (its idle
// connections close on their own; tests/integration/database-client-cache).
// Creating a client opens no connection.
import { describe, expect, it, vi } from "vitest";
import { createClientCache, generatedClientFingerprint, getDatabaseClient, type ClientSlot } from "../../database/src/client";

vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/ai_career_assistant_test");

// The real generated metadata of this checkout's client.
const real = (getDatabaseClient() as unknown as { _engineConfig: Record<string, unknown> })._engineConfig;
const withConfig = (change: (config: Record<string, unknown>) => Record<string, unknown>) => ({ _engineConfig: change({ ...real }) });
const schema = real.inlineSchema as string;

describe("the generated-client fingerprint", () => {
  it("reads the complete generated metadata of a real client", () => {
    expect(schema).toContain("model UserConfirmedFact");
    expect(generatedClientFingerprint(getDatabaseClient())).toMatch(/^[0-9a-f]{64}$/);
    // Stable for the same generation.
    expect(generatedClientFingerprint(withConfig((config) => config))).toBe(generatedClientFingerprint(getDatabaseClient()));
  });

  it("changes for a new model or a new field", () => {
    const base = generatedClientFingerprint(withConfig((config) => config));
    expect(generatedClientFingerprint(withConfig((config) => ({ ...config, inlineSchema: `${schema}\nmodel Added {\n  id String @id\n}\n` })))).not.toBe(base);
    expect(generatedClientFingerprint(withConfig((config) => ({ ...config, inlineSchema: schema.replace("model UserConfirmedFact {", "model UserConfirmedFact {\n  added String?") })))).not.toBe(base);
  });

  it("changes for a semantic change that keeps every model and field name", () => {
    const base = generatedClientFingerprint(withConfig((config) => config));
    const changes: Array<[string, (config: Record<string, unknown>) => Record<string, unknown>]> = [
      ["field type", (config) => ({ ...config, inlineSchema: schema.replace(/salaryMin\s+Decimal\?/, "salaryMin Float?") })],
      ["default", (config) => ({ ...config, inlineSchema: schema.replace("@default(uuid())", "@default(cuid())") })],
      ["database mapping", (config) => ({ ...config, inlineSchema: schema.replace("model Company {", 'model Company {\n  @@map("companies")') })],
      ["relation action", (config) => ({ ...config, inlineSchema: schema.replace("onDelete: Cascade", "onDelete: Restrict") })],
      ["runtime data model", (config) => ({ ...config, runtimeDataModel: { ...(config.runtimeDataModel as object), enums: { Added: { values: [] } } } })],
      ["parameterization schema", (config) => ({ ...config, parameterizationSchema: { changed: true } })],
      ["client version", (config) => ({ ...config, clientVersion: "7.9.2" })],
    ];
    for (const [label, change] of changes) {
      const changed = change({ ...real });
      expect(changed, label).not.toEqual(real);
      expect(generatedClientFingerprint({ _engineConfig: changed }), label).not.toBe(base);
    }
  });
});

type Fake = { name: string; generation: string; $disconnect: ReturnType<typeof vi.fn> };

function harness() {
  const slot: ClientSlot<Fake> = {};
  const created: Fake[] = [];
  const bundle = (generation: string) =>
    createClientCache<Fake>({
      slot,
      create: () => {
        const client = { name: `client-${created.length + 1}`, generation, $disconnect: vi.fn(async () => undefined) };
        created.push(client);
        return client;
      },
      fingerprint: (client) => client.generation,
    });
  return { slot, created, bundle };
}

describe("the process-wide client cache", () => {
  it("shares one client between route bundles of the same generation and never replaces it during ordinary loading", () => {
    const { bundle, created } = harness();
    const routeA = bundle("generation-1");
    const routeB = bundle("generation-1");
    const client = routeA();
    for (let index = 0; index < 50; index += 1) {
      expect(routeA()).toBe(client);
      expect(routeB()).toBe(client);
    }
    // One client, plus route B's probe, which is never connected or used.
    expect(created).toHaveLength(2);
    for (const item of created) expect(item.$disconnect).not.toHaveBeenCalled();
  });

  it("replaces the client after a genuine generated-client change, without disconnecting the old one", () => {
    const { bundle, slot } = harness();
    const old = bundle("generation-1")();
    const replacement = bundle("generation-2")();
    expect(replacement).not.toBe(old);
    expect(replacement.generation).toBe("generation-2");
    expect(slot.client).toBe(replacement);
    // A request or transaction may still be using it: never disconnected.
    expect(old.$disconnect).not.toHaveBeenCalled();
  });

  it("gives an older bundle copy the current client instead of replacing it back (no ping-pong)", () => {
    const { bundle, created } = harness();
    const oldRoute = bundle("generation-1");
    const newRoute = bundle("generation-2");
    oldRoute();
    const current = newRoute();
    const before = created.length;
    for (let index = 0; index < 10; index += 1) {
      expect(oldRoute()).toBe(current);
      expect(newRoute()).toBe(current);
    }
    expect(created).toHaveLength(before);
  });

  it("keeps no replaced client over repeated regeneration", () => {
    const { bundle, slot } = harness();
    for (let round = 1; round <= 20; round += 1) bundle(`generation-${round}`)();
    // Only the current client is referenced; replaced generations are kept
    // as fingerprints (strings) only.
    expect(slot.client?.generation).toBe("generation-20");
    expect(Object.values(slot).filter((value) => typeof value === "object" && value !== null && "generation" in value)).toHaveLength(1);
    expect(slot.retiredFingerprints?.size).toBe(19);
  });

  it("reuses a client cached without a fingerprint (an earlier module version) when it is current", () => {
    const { slot, bundle, created } = harness();
    const legacy = { name: "legacy", generation: "generation-1", $disconnect: vi.fn(async () => undefined) };
    slot.client = legacy;
    expect(bundle("generation-1")()).toBe(legacy);
    expect(bundle("generation-2")()).toBe(created.at(-1));
    expect(legacy.$disconnect).not.toHaveBeenCalled();
  });
});

describe("separate route bundles (real module copies)", () => {
  it("every fresh copy of the module and the generated client returns the same process-wide client", async () => {
    const first = getDatabaseClient();
    for (let copy = 0; copy < 3; copy += 1) {
      vi.resetModules();
      const fresh = await import("../../database/src/client");
      const generated = await import("../../database/generated/prisma/client");
      // A separate copy: its own generated class object...
      expect(fresh.getDatabaseClient).not.toBe(getDatabaseClient);
      void generated;
      // ...and still the one client.
      expect(Object.is(fresh.getDatabaseClient(), first)).toBe(true);
    }
  });
});
