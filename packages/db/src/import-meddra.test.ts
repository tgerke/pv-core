import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { importMeddra, parseLlt, parseMdhier } from "./meddra.js";

/**
 * Verbatim MedDRA import (ADR-0005). The fixture is a five-term file pair in
 * the documented $-delimited layout; it is not MedDRA.
 */

const { db, sql } = createDb();
afterAll(() => sql.end());
const dir = fileURLToPath(new URL("./fixtures/meddra-mini/", import.meta.url));

describe("MedDRA importer (ADR-0005): verbatim, never generated", () => {
  it("parses the documented layouts and refuses malformed lines", () => {
    expect(
      parseMdhier("10000001$10000101$10000201$10000301$Anaemia$H$G$SOC$B$$10000301$Y$"),
    ).toHaveLength(1);
    expect(() => parseMdhier("bad$line$")).toThrow(/expected 12/);
    expect(() => parseLlt("ABC$Anaemia$10000001$$$$$$$Y$$")).toThrow(/8-digit/);
  });

  it("loads every LLT with its primary path and records counts, hash, and is_demo_subset = false", async () => {
    const version = `test-${Date.now()}`;
    const r = await importMeddra(db, { version, dir });
    expect(r.skipped).toBe(false);
    expect(r.termsCount).toBe(5);
    expect(r.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    const [d] =
      await sql`SELECT is_demo_subset, terms_count, source_sha256 FROM dictionary WHERE id = ${r.dictionaryId}`;
    expect(d!.is_demo_subset).toBe(false);
    expect(d!.terms_count).toBe(5);
    expect(d!.source_sha256).toBe(r.sourceSha256);
    const [t] =
      await sql`SELECT * FROM dictionary_term WHERE dictionary_id = ${r.dictionaryId} AND code = '10000012'`;
    expect(t!.pt_term).toBe("Nausea");
    expect(t!.soc_term).toBe("Gastrointestinal disorders");
    expect(t!.is_current).toBe(false);
    // Idempotent: the same release is never loaded twice.
    const again = await importMeddra(db, { version, dir });
    expect(again.skipped).toBe(true);
    expect(again.dictionaryId).toBe(r.dictionaryId);
  });

  it("keeps loaded terms immutable", async () => {
    await expect(sql`DELETE FROM dictionary_term WHERE code = '10000012'`).rejects.toThrow(
      /immutable/,
    );
  });
});
