// Transaction settings and names for the retrieval worker's own
// transactions (November 6, 2026). Every interactive transaction the worker
// runs states its limits explicitly (never Prisma's 2 s / 5 s defaults), and
// a failure names the transaction it happened in, so a P2028 can be traced to
// its operation in the worker's diagnostics. No data is attached.
export const workerTransactionOptions = { maxWait: 15_000, timeout: 30_000 } as const;

export async function namedTransaction<T>(name: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error && typeof error === "object") Object.assign(error, { captureTransaction: name });
    throw error;
  }
}
