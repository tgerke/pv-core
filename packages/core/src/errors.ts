export type CoreErrorCode = "not_found" | "invalid" | "conflict" | "locked" | "forbidden";

/** Domain error the API maps to a status code (404/400/409/423/403). */
export class CoreError extends Error {
  constructor(
    public readonly code: CoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CoreError";
  }
}

/**
 * Postgres raises from the compliance triggers (0001) surface as CoreErrors:
 * a lock is 423, an immutability or guard rejection 409, a CHECK 400.
 */
export function fromPgError(err: unknown): CoreError | null {
  const e = err as { code?: string; message?: string; constraint_name?: string };
  if (!e || typeof e !== "object" || !e.code) return null;
  const msg = e.message ?? "database rejected the write";
  if (e.code === "P0001") {
    if (msg.includes("locked by a signature")) return new CoreError("locked", msg);
    return new CoreError("conflict", msg);
  }
  if (e.code === "23514" || e.code === "22P02") return new CoreError("invalid", msg);
  if (e.code === "23505") return new CoreError("conflict", msg);
  if (e.code === "23503") return new CoreError("invalid", msg);
  return null;
}
