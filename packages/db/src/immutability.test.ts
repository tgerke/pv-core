import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";

const { sql } = createDb();
afterAll(() => sql.end());

const ROLLBACK = new Error("rollback");
/** Run mutations in a transaction that always rolls back. */
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

describe("append-only enforcement (Part 11 §11.10(c) §11.10(e))", () => {
  it("rejects UPDATE and DELETE on audit_event at the database level", async () => {
    await expect(
      sql`UPDATE audit_event SET actor_label = 'tampered' WHERE id = (SELECT min(id) FROM audit_event)`,
    ).rejects.toThrow(/immutable/);
    await expect(
      sql`DELETE FROM audit_event WHERE id = (SELECT min(id) FROM audit_event)`,
    ).rejects.toThrow(/immutable/);
  });

  it("rejects UPDATE and DELETE on signature (§11.70 binding stays intact)", async () => {
    await expect(sql`UPDATE signature SET meaning = 'approval'`).rejects.toThrow(/immutable/);
    await expect(sql`DELETE FROM signature`).rejects.toThrow(/immutable/);
  });

  it("rejects UPDATE and DELETE on submission and submission_acknowledgement", async () => {
    await expect(sql`UPDATE submission SET note = 'rewritten'`).rejects.toThrow(/immutable/);
    await expect(sql`DELETE FROM submission`).rejects.toThrow(/immutable/);
    await expect(sql`DELETE FROM submission_acknowledgement`).rejects.toThrow(/immutable/);
  });

  it("rejects UPDATE and DELETE on the case facts: transitions, unblinding, nullification, attachments", async () => {
    await expect(sql`UPDATE case_transition SET note = 'x'`).rejects.toThrow(/immutable/);
    await expect(sql`DELETE FROM case_unblinding`).rejects.toThrow(/immutable/);
    await expect(sql`UPDATE case_nullification SET reason = 'x'`).rejects.toThrow(/immutable/);
    await expect(sql`DELETE FROM case_attachment`).rejects.toThrow(/immutable/);
  });

  it("never deletes a case; identity columns cannot change (E2B(R3) C.1.8.1)", async () => {
    await expect(sql`DELETE FROM "case"`).rejects.toThrow(/never deleted/);
    await inRollback(async (tx) => {
      await expect(
        tx`UPDATE "case" SET worldwide_unique_id = 'X' WHERE sender_case_id = 'US-CORC-2026-0004'`,
      ).rejects.toThrow(/immutable/);
    });
  });

  it("locks a signed version and its children (ADR-0006)", async () => {
    const [v] = await sql`
      SELECT cv.id FROM case_version cv JOIN "case" c ON c.id = cv.case_id
      WHERE c.sender_case_id = 'US-CORC-2026-0004' AND cv.version_number = 1`;
    // Each rejection aborts its transaction, so one rollback per statement.
    const rejected = async (run: (tx: typeof sql) => Promise<unknown>) => {
      let message = "";
      await inRollback(async (tx) => {
        await run(tx).catch((e: Error) => {
          message = e.message;
        });
      });
      expect(message).toMatch(/locked by a signature/);
    };
    await rejected(
      (tx) => tx`UPDATE case_narrative SET narrative = 'edited' WHERE case_version_id = ${v!.id}`,
    );
    await rejected((tx) => tx`DELETE FROM case_event WHERE case_version_id = ${v!.id}`);
    await rejected(
      (tx) =>
        tx`INSERT INTO case_test (case_version_id, seq, test_name) VALUES (${v!.id}, 99, 'sneak')`,
    );
    await rejected(
      (tx) => tx`UPDATE case_version SET awareness_date = CURRENT_DATE WHERE id = ${v!.id}`,
    );
  });

  it("rejects further versions of a nullified case (C.1.11)", async () => {
    const [c] =
      await sql`SELECT id, created_by FROM "case" WHERE sender_case_id = 'US-CORC-2026-0007'`;
    const [d] = await sql`SELECT id FROM dictionary LIMIT 1`;
    await inRollback(async (tx) => {
      await expect(tx`
        INSERT INTO case_version (case_id, version_number, kind, info_received_date, awareness_date, dictionary_id, created_by)
        VALUES (${c!.id}, 99, 'follow_up', CURRENT_DATE, CURRENT_DATE, ${d!.id}, ${c!.created_by})`).rejects.toThrow(
        /nullified/,
      );
    });
  });
});

describe("audit trail (§11.10(e), ADR-0003)", () => {
  it("writes an attributed, chained event for every domain mutation", async () => {
    await inRollback(async (tx) => {
      await tx`SELECT set_config('pv.actor_label', 'vitest', true)`;
      await tx`INSERT INTO organization (name, kind) VALUES ('Audit Probe Org', 'cro')`;
      const [event] = await tx`SELECT * FROM audit_event ORDER BY id DESC LIMIT 1`;
      expect(event!.action).toBe("organization.insert");
      expect(event!.actor_label).toBe("vitest");
      expect(event!.after.name).toBe("Audit Probe Org");
      expect(event!.hash).toMatch(/^[0-9a-f]{64}$/);
      const [prev] = await tx`SELECT hash FROM audit_event WHERE id = ${event!.id - 1}`;
      expect(event!.prev_hash).toBe(prev!.hash);
    });
  });

  it("verifies clean on untampered data", async () => {
    const problems = await sql`SELECT * FROM pv_verify_audit_chain()`;
    expect(problems).toHaveLength(0);
  });

  it("detects tampering when a row is altered with triggers disabled", async () => {
    await inRollback(async (tx) => {
      await tx`ALTER TABLE audit_event DISABLE TRIGGER audit_event_immutable`;
      const [second] = await tx`SELECT id FROM audit_event ORDER BY id LIMIT 1 OFFSET 1`;
      await tx`UPDATE audit_event SET actor_label = 'evil' WHERE id = ${second!.id}`;
      const problems = await tx`SELECT * FROM pv_verify_audit_chain()`;
      expect(problems.length).toBeGreaterThan(0);
      expect(String(problems[0]!.event_id)).toBe(String(second!.id));
      expect(problems[0]!.problem).toMatch(/hash does not match/);
    });
  });
});

describe("guards (0001): CHECK constraints the schema carries", () => {
  it("requires a rationale when the awareness date differs from the receipt date (E2A §III.B.3, ADR-0007)", async () => {
    await inRollback(async (tx) => {
      const [c] =
        await tx`SELECT id, created_by FROM "case" WHERE sender_case_id = 'US-CORC-2026-0005'`;
      const [d] = await tx`SELECT id FROM dictionary LIMIT 1`;
      await expect(tx`
        INSERT INTO case_version (case_id, version_number, kind, info_received_date, awareness_date, dictionary_id, created_by)
        VALUES (${c!.id}, 98, 'follow_up', CURRENT_DATE, CURRENT_DATE - 3, ${d!.id}, ${c!.created_by})`).rejects.toThrow(
        /awareness_rationale/,
      );
    });
  });

  it("requires an expectedness override and its rationale together (E2A §II.C.2)", async () => {
    await inRollback(async (tx) => {
      const [a] = await tx`
        SELECT a.id FROM case_assessment a JOIN case_version cv ON cv.id = a.case_version_id JOIN "case" c ON c.id = cv.case_id
        WHERE c.sender_case_id = 'US-CORC-2026-0005' LIMIT 1`;
      await expect(
        tx`UPDATE case_assessment SET expectedness_override = 'unexpected' WHERE id = ${a!.id}`,
      ).rejects.toThrow(/override_rationale/);
    });
  });

  it("scopes a grant to a sponsor or a study, never both (ADR-0015)", async () => {
    await inRollback(async (tx) => {
      const [p] = await tx`SELECT id FROM person LIMIT 1`;
      const [o] = await tx`SELECT id FROM organization WHERE kind = 'sponsor' LIMIT 1`;
      const [s] = await tx`SELECT id FROM study LIMIT 1`;
      await expect(tx`
        INSERT INTO access_grant (person_id, role, organization_id, study_id) VALUES (${p!.id}, 'read_only', ${o!.id}, ${s!.id})`).rejects.toThrow(
        /single_scope/,
      );
    });
  });
});
