import { describe, expect, it } from "vitest";
import {
  UnsafeTestDatabaseError,
  assertIsolatedTestDatabase,
  databaseNameOf,
} from "../support/test-database-guard";

const url = (name: string) => `postgresql://postgres:postgres@localhost:5432/${name}?schema=public`;

describe("test database guard", () => {
  it("accepts an isolated test database", () => {
    expect(assertIsolatedTestDatabase(url("ai_career_assistant_test"), "Tests")).toBe("ai_career_assistant_test");
    expect(assertIsolatedTestDatabase("postgres://u:p@db:5432/other_test", "Tests")).toBe("other_test");
  });

  it("refuses the normal application and acceptance databases", () => {
    for (const name of ["ai_career_assistant", "ai_career_assistant_acceptance", "postgres", "ai_career_assistant_testing", "test", "ai_career_assistant_test_copy"]) {
      expect(() => assertIsolatedTestDatabase(url(name), "Integration tests")).toThrow(UnsafeTestDatabaseError);
    }
    expect(() => assertIsolatedTestDatabase(url("ai_career_assistant"), "Integration tests")).toThrow(/"ai_career_assistant" is not an isolated test database/);
  });

  it("refuses a missing, unreadable or non-PostgreSQL target", () => {
    for (const value of [undefined, null, "", "   ", "not a url", "mysql://u:p@h/x_test", "postgresql://u:p@localhost:5432/"]) {
      expect(() => assertIsolatedTestDatabase(value, "E2E tests")).toThrow(UnsafeTestDatabaseError);
    }
  });

  it("reads the database name without connecting", () => {
    expect(databaseNameOf(url("ai_career_assistant_test"))).toBe("ai_career_assistant_test");
    expect(databaseNameOf("postgresql://localhost/a%5Fb_test")).toBe("a_b_test");
    expect(databaseNameOf("nonsense")).toBeNull();
  });
});
