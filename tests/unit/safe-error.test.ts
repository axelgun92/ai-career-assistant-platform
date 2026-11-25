// Safe dashboard diagnostics (November 25, 2026): the error's name, code,
// database code, a redacted message and its causes, with the request's view,
// filter and page context; never secrets, connection strings, quoted values,
// e-mail addresses, job text or the search a user typed.
import { describe, expect, it } from "vitest";
import { dashboardQueryContext, redactErrorMessage, safeErrorDetails } from "../../apps/web/src/server/safe-error";
import { parseOpportunityQuery } from "../../apps/web/src/server/opportunity-query";

describe("safe error details", () => {
  it("keeps the kind of failure and removes everything sensitive", () => {
    const error = Object.assign(
      new Error(
        "Invalid `prisma.$queryRaw()` invocation: Raw query failed. Code: `57P01`. Message: `terminating connection` for postgresql://alex:hunter2@db.internal:5432/ai_career_assistant_acceptance " +
          "password=hunter2 sk-abcdefghijklmnop alex@example.com job 'Own onboarding for Acme' id 4123456789",
      ),
      { name: "PrismaClientKnownRequestError", code: "P2010", meta: { code: "57P01", message: "terminating connection due to administrator command" } },
    );
    const details = safeErrorDetails(error);
    expect(details).toMatchObject({ errorName: "PrismaClientKnownRequestError", errorCode: "P2010", databaseCode: "57P01" });
    const text = JSON.stringify(details);
    for (const secret of ["hunter2", "db.internal", "alex@example.com", "sk-abcdefghijklmnop", "Own onboarding", "4123456789", "acceptance"]) {
      expect(text).not.toContain(secret);
    }
    expect(details.errorMessage).toContain("`prisma.$queryRaw()`");
    expect(details.errorMessage).toContain("`57P01`");
    expect(details.errorMessage).toContain("[url]");
    expect(details.errorMessage!.length).toBeLessThanOrEqual(240);
  });

  it("follows the chain of causes, three deep at most", () => {
    const root = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    const chained = new Error("Transaction failed", { cause: new Error("query failed", { cause: root }) });
    expect(safeErrorDetails(chained)).toEqual({
      errorName: "Error",
      errorMessage: "Transaction failed",
      cause: { errorName: "Error", errorMessage: "query failed", cause: { errorName: "Error", errorCode: "ECONNREFUSED", errorMessage: "connect ECONNREFUSED 127.0.0.1:5432" } },
    });
    let deep: Error = new Error("0");
    for (let level = 1; level < 8; level += 1) deep = new Error(String(level), { cause: deep });
    expect(JSON.stringify(safeErrorDetails(deep)).match(/errorName/g)).toHaveLength(4);
    expect(safeErrorDetails({ password: "x" })).toEqual({ errorName: "NonErrorObject" });
    expect(safeErrorDetails("boom")).toEqual({ errorName: "Non-error string" });
  });

  it("describes the request by view, page and filter names, never by what was typed", () => {
    const query = parseOpportunityQuery(new URLSearchParams("view=dismissed&q=secret+employer&company=acme&rec=apply&triage=reject&page=2&pageSize=50"));
    expect(dashboardQueryContext(query)).toEqual({
      view: "dismissed", page: 2, pageSize: 50, sort: "newest", searched: true, triage: "reject", filters: ["company", "rec"],
    });
    expect(JSON.stringify(dashboardQueryContext(query))).not.toMatch(/secret|employer|acme/);
  });

  it("drops the source lines Prisma quotes, keeping the call and the explanation", () => {
    const message = [
      "",
      "Invalid `prisma.preEvaluatorTriage.findMany()` invocation in",
      "/home/user/app/.next/dev/server/chunks/ssr/database_1.js:10230:61",
      "",
      "  10227 // The Needs Review queue holds jobs",
      "→ 10230 const rows = await this.database.preEvaluatorTriage.findMany(",
      "",
      "Can't reach database server at 127.0.0.1:5432",
    ].join("\n");
    expect(redactErrorMessage(message)).toBe("Invalid `prisma.preEvaluatorTriage.findMany()` invocation: Can't reach database server at 127.0.0.1:5432");
  });

  it("redacts quoted values but keeps call names and SQLSTATE codes", () => {
    expect(redactErrorMessage('invalid input syntax for type uuid: "not-a-uuid"')).toBe("invalid input syntax for type uuid: [value]");
    expect(redactErrorMessage("Code: `23505`. `prisma.opportunity.findMany()`")).toBe("Code: `23505`. `prisma.opportunity.findMany()`");
  });
});
