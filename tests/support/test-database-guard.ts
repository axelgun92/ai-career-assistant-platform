// Test-infrastructure guard: automated tests that use a database may run
// only against an explicitly isolated test database, one whose name ends in
// "_test" (such as ai_career_assistant_test). Every other target is refused
// before any test starts, among them the normal application database
// (ai_career_assistant) and the acceptance database
// (ai_career_assistant_acceptance). It reads only the connection URL: it
// never connects, and it changes nothing in how the application itself
// chooses or uses its database.

export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTestDatabaseError";
  }
}

const isolatedTestDatabaseName = /^[A-Za-z0-9_]+_test$/;

// The database name in a PostgreSQL connection URL, or null when the URL is
// missing, unreadable or names no database.
export function databaseNameOf(url: string | undefined | null): string | null {
  if (!url?.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) return null;
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  return name || null;
}

// Returns the isolated test database's name, or throws UnsafeTestDatabaseError.
export function assertIsolatedTestDatabase(url: string | undefined | null, purpose: string): string {
  const name = databaseNameOf(url);
  if (!name) {
    throw new UnsafeTestDatabaseError(
      `${purpose} refused: no readable PostgreSQL DATABASE_URL. Set TEST_DATABASE_URL to an isolated test database whose name ends in "_test" (for example ai_career_assistant_test).`,
    );
  }
  if (!isolatedTestDatabaseName.test(name)) {
    throw new UnsafeTestDatabaseError(
      `${purpose} refused: the target database "${name}" is not an isolated test database. Automated tests run only against a database whose name ends in "_test" (for example ai_career_assistant_test); set TEST_DATABASE_URL to one.`,
    );
  }
  return name;
}
