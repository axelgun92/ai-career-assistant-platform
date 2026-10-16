// Task 9 completion pass: the health endpoint's failure path, error-name-only
// logging in the opportunity API routes, and the non-live E2E credential.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { e2eDeterministicOpenAiKey, e2eEnvironment } from "../support/e2e-environment";

const { database, manual } = vi.hoisted(() => ({
  database: { queryRaw: vi.fn() },
  manual: { submit: vi.fn(), getById: vi.fn() },
}));

vi.mock("../../apps/web/node_modules/next/server.js", () => ({ connection: async () => undefined }));
vi.mock("@ai-career/database", () => ({
  getDatabaseClient: () => ({ $queryRaw: database.queryRaw }),
}));
vi.mock("@/server/manual-opportunity-service", () => ({ getManualOpportunityService: () => manual }));
vi.mock("@/server/opportunity-list-service", () => ({
  createOpportunityListHandler: () => async () => new Response(null),
  getOpportunityListReader: () => ({}),
}));

const { GET: health } = await import("../../apps/web/src/app/api/health/route");
const { POST: createOpportunity } = await import("../../apps/web/src/app/api/opportunities/route");
const { GET: readOpportunity } = await import("../../apps/web/src/app/api/opportunities/[id]/route");

// Details a raw database or driver error can carry; none may reach a
// response body or a log line.
const sensitive = [
  "postgresql://admin:hunter2@db.internal:5432/careers",
  "db.internal",
  "hunter2",
  "Senior Customer Success Manager at Confidential Corp",
];
const rawDatabaseError = () =>
  Object.assign(
    new Error(`connect ECONNREFUSED ${sensitive[0]} while storing "${sensitive[3]}"`),
    { name: "PrismaClientKnownRequestError", code: "P1001" },
  );

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  database.queryRaw.mockReset();
  manual.submit.mockReset();
  manual.getById.mockReset();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  errorLog.mockRestore();
  vi.unstubAllEnvs();
});

const expectNothingSensitive = (text: string) => {
  for (const value of sensitive) expect(text).not.toContain(value);
};
// Error messages and stacks are not enumerable, so serialize them explicitly:
// logging a raw error object must fail these checks.
const loggedText = () =>
  JSON.stringify(errorLog.mock.calls, (_key, value: unknown) =>
    value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value,
  );

describe("GET /api/health", () => {
  it("is healthy when the database answers, reporting only whether AI is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    database.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const response = await health();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "ai-career-platform",
      database: "ok",
      aiConfigured: false,
    });
  });

  it("returns 503 degraded when the database is unreachable, without any error detail", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    database.queryRaw.mockRejectedValue(rawDatabaseError());
    const response = await health();
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      status: "degraded",
      service: "ai-career-platform",
      database: "unavailable",
      aiConfigured: false,
    });
    expectNothingSensitive(text);
    expectNothingSensitive(loggedText());
  });

  it("never echoes the configured key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "YOUR_OPENAI_API_KEY");
    database.queryRaw.mockResolvedValue([]);
    const text = await (await health()).text();
    expect(JSON.parse(text)).toMatchObject({ aiConfigured: false });
    expect(text).not.toContain("YOUR_OPENAI_API_KEY");
  });
});

describe("opportunity API routes log only the error name", () => {
  it("POST /api/opportunities keeps its response and logs no raw error", async () => {
    manual.submit.mockRejectedValue(rawDatabaseError());
    const response = await createOpportunity(
      new Request("http://localhost/api/opportunities", { method: "POST", body: JSON.stringify({ title: sensitive[3] }) }),
    );
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "The opportunity could not be stored" });
    expect(errorLog).toHaveBeenCalledWith("Manual opportunity submission failed", {
      errorName: "PrismaClientKnownRequestError",
    });
    expectNothingSensitive(text);
    expectNothingSensitive(loggedText());
  });

  it("GET /api/opportunities/[id] keeps its response and logs no raw error", async () => {
    manual.getById.mockRejectedValue(rawDatabaseError());
    const response = await readOpportunity(new Request("http://localhost/x"), {
      params: Promise.resolve({ id: "6f1c9c3e-1d55-4a3b-9b9f-0d2b8a1e4c11" }),
    });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "The opportunity could not be retrieved" });
    expect(errorLog).toHaveBeenCalledWith("Opportunity retrieval failed", { errorName: "PrismaClientKnownRequestError" });
    expectNothingSensitive(text);
    expectNothingSensitive(loggedText());
  });

  it("logs UnknownError for non-Error values", async () => {
    manual.submit.mockRejectedValue("a thrown string with db.internal");
    await createOpportunity(new Request("http://localhost/api/opportunities", { method: "POST", body: "{}" }));
    expect(errorLog).toHaveBeenCalledWith("Manual opportunity submission failed", { errorName: "UnknownError" });
    expect(loggedText()).not.toContain("db.internal");
  });
});

describe("E2E environment", () => {
  it("always uses the deterministic, non-live key, whatever the environment provides", () => {
    for (const key of ["sk-live-looking-0123456789abcdefghijklmnop", "YOUR_OPENAI_API_KEY", "", undefined]) {
      expect(e2eEnvironment({ OPENAI_API_KEY: key }).OPENAI_API_KEY).toBe(e2eDeterministicOpenAiKey);
    }
    expect(e2eDeterministicOpenAiKey.startsWith("sk-")).toBe(false);
  });

  it("still lets the environment choose the other AI and queue settings", () => {
    const environment = e2eEnvironment({ AI_MODEL: "gpt-5.6-luna", EVALUATION_WORKER_POLL_MS: "250" });
    expect(environment).toMatchObject({ AI_MODEL: "gpt-5.6-luna", EVALUATION_WORKER_POLL_MS: "250" });
    expect(e2eEnvironment({}).AI_MODEL).toBe("gpt-5.6-terra");
  });
});
