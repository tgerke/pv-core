import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { appDatabaseUrl, databaseUrl } from "./env.js";

/**
 * Least-privilege runtime roles (migration 0002, ADR-0003, ADR-0008): the API
 * connects as pv_app, which can do DML but cannot TRUNCATE, run DDL, disable
 * triggers, or write audit_event directly; pv_readonly reads the views and
 * never the arm columns at rest.
 */

const { sql } = createDb(appDatabaseUrl());
const readonlyUrl = (() => {
  const u = new URL(databaseUrl());
  u.username = "pv_readonly";
  u.password = "pv_readonly";
  return u.toString();
})();
const { sql: ro } = createDb(readonlyUrl);
afterAll(async () => {
  await sql.end();
  await ro.end();
});

const ROLLBACK = new Error("rollback");
async function inRollback(fn: (tx: typeof sql) => Promise<void>) {
  await sql
    .begin(async (tx) => {
      await fn(tx as unknown as typeof sql);
      throw ROLLBACK;
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
}

describe("least-privilege runtime role pv_app (§11.10(c) §11.10(d))", () => {
  it("cannot TRUNCATE domain tables", async () => {
    await expect(sql`TRUNCATE person CASCADE`).rejects.toThrow(/permission denied/);
    await expect(sql`TRUNCATE audit_event`).rejects.toThrow(/permission denied/);
  });

  it("cannot disable triggers (not the table owner)", async () => {
    await expect(
      sql`ALTER TABLE audit_event DISABLE TRIGGER audit_event_immutable`,
    ).rejects.toThrow(/must be owner/);
    await expect(sql`ALTER TABLE case_event DISABLE TRIGGER case_event_lock`).rejects.toThrow(
      /must be owner/,
    );
  });

  it("cannot run DDL in the schema", async () => {
    await expect(sql`CREATE TABLE pv_app_probe (id int)`).rejects.toThrow(/permission denied/);
    await expect(sql`DROP TABLE person`).rejects.toThrow(/must be owner/);
  });

  it("cannot write audit_event directly, yet its DML is still audited", async () => {
    await expect(sql`
      INSERT INTO audit_event (occurred_at, actor_label, action, entity_type, prev_hash, hash)
      VALUES (now(), 'forger', 'fake.insert', 'organization', repeat('0', 64), repeat('0', 64))
    `).rejects.toThrow(/permission denied/);
    await inRollback(async (tx) => {
      await tx`SELECT set_config('pv.actor_label', 'pv_app vitest', true)`;
      await tx`INSERT INTO organization (name, kind) VALUES ('App Role Probe', 'cro')`;
      const [event] = await tx`SELECT * FROM audit_event ORDER BY id DESC LIMIT 1`;
      expect(event!.action).toBe("organization.insert");
      expect(event!.actor_label).toBe("pv_app vitest");
    });
  });

  it("holds no UPDATE/DELETE privilege on immutable facts even before the trigger fires", async () => {
    await expect(sql`DELETE FROM signature`).rejects.toThrow(/permission denied|immutable/);
    await expect(sql`UPDATE case_unblinding SET reason = 'x'`).rejects.toThrow(
      /permission denied|immutable/,
    );
  });
});

describe("read-only role pv_readonly (ADR-0008: arms at rest stay out of reach)", () => {
  it("reads the derived views", async () => {
    const rows = await ro`SELECT count(*)::int AS n FROM v_case_queue`;
    expect(rows[0]!.n).toBeGreaterThan(0);
  });

  it("cannot read the arm columns of case_unblinding", async () => {
    await expect(ro`SELECT arm_label FROM case_unblinding`).rejects.toThrow(/permission denied/);
    const rows = await ro`SELECT id, unblinded_at FROM case_unblinding`;
    expect(Array.isArray(rows)).toBe(true);
  });

  it("cannot write anything", async () => {
    await expect(
      ro`INSERT INTO organization (name, kind) VALUES ('ro probe', 'cro')`,
    ).rejects.toThrow(/permission denied/);
  });
});
