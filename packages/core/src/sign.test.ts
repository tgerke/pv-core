import { createDb } from "@pv-core/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCase, signVersion, versionHash } from "./cases.js";
import { CoreError } from "./errors.js";
import { recordAcknowledgement, recordSubmission } from "./reporting.js";
import { type Fixture, loadFixture, validCaseInput } from "./test-helpers.js";

/** Signatures bind to the version hash (§11.70); submissions require an approval bound to the current hash. */

const { db, sql } = createDb();
const actor = { label: "vitest sign" };
let fx: Fixture;
beforeAll(async () => {
  fx = await loadFixture(sql);
});
afterAll(() => sql.end());

describe("e-signatures (§11.50 §11.70 §11.200)", () => {
  it("a signature copies the version hash and records how the signer re-authenticated", async () => {
    const c = await createCase(db, actor, await validCaseInput(fx));
    const hash = await db.transaction((tx) => versionHash(tx, c.caseVersionId));
    const s = await signVersion(db, actor, {
      versionId: c.caseVersionId,
      signerPersonId: fx.people.reviewer,
      meaning: "medical_review",
      reauthMethod: "dev_token",
      reauthAt: new Date(),
    });
    expect(s.signedSha256).toBe(hash);
    const [row] =
      await sql`SELECT s.meaning, s.reauth_method, si.hash_matches FROM signature s JOIN v_signature_integrity si ON si.signature_id = s.id WHERE s.id = ${s.signatureId}`;
    expect(row!.meaning).toBe("medical_review");
    expect(row!.reauth_method).toBe("dev_token");
    expect(row!.hash_matches).toBe(true);
  });

  it("the database refuses a signature without re-authentication evidence", async () => {
    const c = await createCase(db, actor, await validCaseInput(fx));
    await expect(sql`
      INSERT INTO signature (case_version_id, signer_person_id, meaning, signed_sha256)
      VALUES (${c.caseVersionId}, ${fx.people.reviewer}, 'approval', repeat('0', 64))`).rejects.toThrow(
      /null value|not-null/,
    );
  });

  it("a submission needs an approval signature bound to the current hash and copies that hash", async () => {
    const c = await createCase(db, actor, await validCaseInput(fx));
    const early = await recordSubmission(db, actor, {
      caseVersionId: c.caseVersionId,
      destinationId: fx.fdaDestinationId,
      kind: "initial_report",
      format: "cioms_i_pdf",
      sentBy: fx.people.processor,
    }).catch((e) => e);
    expect(early).toBeInstanceOf(CoreError);
    expect((early as CoreError).message).toMatch(/approval signature/);
    await signVersion(db, actor, {
      versionId: c.caseVersionId,
      signerPersonId: fx.people.reviewer,
      meaning: "medical_review",
      reauthMethod: "dev_token",
      reauthAt: new Date(),
    });
    const stillEarly = await recordSubmission(db, actor, {
      caseVersionId: c.caseVersionId,
      destinationId: fx.fdaDestinationId,
      kind: "initial_report",
      format: "cioms_i_pdf",
      sentBy: fx.people.processor,
    }).catch((e) => e);
    expect((stillEarly as CoreError).message).toMatch(/approval signature/);
    const approval = await signVersion(db, actor, {
      versionId: c.caseVersionId,
      signerPersonId: fx.people.reviewer,
      meaning: "approval",
      reauthMethod: "dev_token",
      reauthAt: new Date(),
    });
    const sub = await recordSubmission(db, actor, {
      caseVersionId: c.caseVersionId,
      destinationId: fx.fdaDestinationId,
      kind: "initial_report",
      format: "e2b_r3_json",
      sentBy: fx.people.processor,
      payload: {
        bytes: new TextEncoder().encode('{"C.1.1":"x"}'),
        fileName: "x.json",
        mimeType: "application/json",
      },
    });
    const [row] =
      await sql`SELECT case_version_sha256, payload_sha256 FROM submission WHERE id = ${sub.id}`;
    expect(row!.case_version_sha256).toBe(approval.signedSha256);
    expect(row!.payload_sha256).toBe(sub.payloadSha256);
    const [att] = await sql`SELECT kind FROM case_attachment WHERE sha256 = ${sub.payloadSha256}`;
    expect(att!.kind).toBe("submission_payload");
    const ack = await recordAcknowledgement(db, actor, {
      submissionId: sub.id,
      ackCode: "CA",
      recordedBy: fx.people.processor,
    });
    expect(ack.id).toBeTruthy();
    const [st] =
      await sql`SELECT status FROM v_expected_submission_status WHERE case_id = ${c.caseId} AND rule_name LIKE 'FDA IND 15-day%'`;
    expect(st!.status).toBe("acknowledged");
  });
});
