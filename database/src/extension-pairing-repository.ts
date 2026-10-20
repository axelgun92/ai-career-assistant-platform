import { getDatabaseClient } from "./client";

// Browsers paired with the extension companion (feature 14B). The
// repository stores and reads hashes only; generating and hashing the
// pairing credential is the web server's job, and the credential itself
// never reaches the database.

export interface ExtensionPairingRecord {
  id: string;
  label: string;
  tokenHint: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

const publicFields = { id: true, label: true, tokenHint: true, createdAt: true, lastUsedAt: true, revokedAt: true } as const;

export class PrismaExtensionPairingRepository {
  private readonly database = getDatabaseClient();

  async create(input: { label: string; tokenHash: string; tokenHint: string }): Promise<ExtensionPairingRecord> {
    return this.database.extensionPairing.create({ data: input, select: publicFields });
  }

  // Newest first, revoked pairings included.
  async list(): Promise<ExtensionPairingRecord[]> {
    return this.database.extensionPairing.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: publicFields });
  }

  // The pairing a credential hash belongs to, with the stored hash so the
  // caller can compare it in constant time; null when none matches. Revoked
  // pairings are returned too, and the caller refuses them.
  async findByHash(tokenHash: string): Promise<(ExtensionPairingRecord & { tokenHash: string }) | null> {
    return this.database.extensionPairing.findUnique({ where: { tokenHash }, select: { ...publicFields, tokenHash: true } });
  }

  async markUsed(id: string, at: Date): Promise<void> {
    await this.database.extensionPairing.updateMany({ where: { id, revokedAt: null }, data: { lastUsedAt: at } });
  }

  // Revoking is final and idempotent: an already revoked pairing keeps its
  // first revocation time. Null when no pairing has this ID.
  async revoke(id: string, at: Date): Promise<ExtensionPairingRecord | null> {
    await this.database.extensionPairing.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: at } });
    return this.database.extensionPairing.findUnique({ where: { id }, select: publicFields });
  }

  async countActive(): Promise<number> {
    return this.database.extensionPairing.count({ where: { revokedAt: null } });
  }
}
