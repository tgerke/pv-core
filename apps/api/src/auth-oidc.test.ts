import { createServer, type Server } from "node:http";
import { loadFixture } from "@pv-core/core/test-helpers";
import { createDb } from "@pv-core/db";
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { resetOidcCache } from "./auth.js";

/**
 * OIDC-mode authentication and §11.200 re-auth against a mock identity
 * provider (ADR-0016): an in-process HTTP server exposing an OIDC discovery
 * document and a JWKS, with tokens minted locally. Exercises exactly the
 * JWT-validation path a real IdP (Okta, Entra, Keycloak) would hit.
 */

const { db, sql } = createDb();
let app: ReturnType<typeof buildApp>;
let fx: Awaited<ReturnType<typeof loadFixture>>;
let issuer: string;
let idp: Server;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;

const AUDIENCE = "pv-api";
// The seeded safety physician (email survives re-seeding).
const REVIEWER_EMAIL = "priya.raman@corc.example";

async function mint(
  claims: JWTPayload & { email?: string },
  audience = AUDIENCE,
  subject = "vitest-subject",
) {
  return new SignJWT({ email: REVIEWER_EMAIL, email_verified: true, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "vitest" })
    .setSubject(subject)
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime("5m")
    .sign(keys.privateKey);
}

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: "vitest", alg: "RS256" };
  idp = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url?.includes("openid-configuration")) {
      res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
    } else if (req.url?.includes("jwks")) {
      res.end(JSON.stringify({ keys: [jwk] }));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => idp.listen(0, "127.0.0.1", resolve));
  const address = idp.address();
  issuer = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  process.env.AUTH_MODE = "oidc";
  process.env.OIDC_ISSUER = issuer;
  process.env.OIDC_AUDIENCE = AUDIENCE;
  process.env.API_SERVICE_SUBJECTS = "edc-intake-client:edc.intake@corc.example";
  resetOidcCache();
  app = buildApp(db, sql);
  fx = await loadFixture(sql);
});

afterAll(async () => {
  process.env.AUTH_MODE = "dev";
  await new Promise<void>((resolve) => idp.close(() => resolve()));
  await sql.end();
});

describe("OIDC authentication (§11.10(d), ADR-0016)", () => {
  it("accepts a valid token and resolves the person by verified email claim", async () => {
    const res = await app.request("/me", {
      headers: { Authorization: `Bearer ${await mint({})}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { label: string }).label).toMatch(/Priya Raman/);
  });

  it("rejects a token for the wrong audience and a forged token (wrong key)", async () => {
    expect(
      (
        await app.request("/me", {
          headers: { Authorization: `Bearer ${await mint({}, "other-api")}` },
        })
      ).status,
    ).toBe(401);
    const rogue = await generateKeyPair("RS256");
    const forged = await new SignJWT({ email: REVIEWER_EMAIL, email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: "vitest" })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(rogue.privateKey);
    expect(
      (await app.request("/me", { headers: { Authorization: `Bearer ${forged}` } })).status,
    ).toBe(401);
  });

  it("rejects an authenticated identity with no person record (403, never a fallback actor)", async () => {
    expect(
      (
        await app.request("/me", {
          headers: { Authorization: `Bearer ${await mint({ email: "stranger@example.com" })}` },
        })
      ).status,
    ).toBe(403);
  });

  it("rejects a token whose email is explicitly unverified", async () => {
    expect(
      (
        await app.request("/me", {
          headers: { Authorization: `Bearer ${await mint({ email_verified: false })}` },
        })
      ).status,
    ).toBe(403);
  });

  it("maps a machine identity by subject (API_SERVICE_SUBJECTS) to the enter-only intake person", async () => {
    const svc = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "vitest" })
      .setSubject("edc-intake-client")
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(keys.privateKey);
    // Reads nothing (ingest is enter-only), creates a case fine.
    expect(
      (await app.request("/queue", { headers: { Authorization: `Bearer ${svc}` } })).status,
    ).toBe(403);
    const res = await app.request("/cases", {
      method: "POST",
      headers: { Authorization: `Bearer ${svc}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        study_id: fx.studyId,
        product_id: fx.productId,
        first_received_date: fx.today,
        source: { system: "edc-core", ref: "SAE-OIDC-1" },
      }),
    });
    expect(res.status).toBe(201);
  });
});

describe("OIDC signing re-authentication (§11.200)", () => {
  async function fixtureVersion(): Promise<string> {
    // Created by the seeded processor in dev-token terms; OIDC mode is on, so
    // use core directly for the fixture and the API for the ceremony.
    const { createCase } = await import("@pv-core/core");
    const { validCaseInput } = await import("@pv-core/core/test-helpers");
    const c = await createCase(db, { label: "vitest oidc" }, await validCaseInput(fx));
    return c.caseVersionId;
  }
  const sign = (session: string, versionId: string, reauth: string) =>
    app.request(`/case-versions/${versionId}/sign`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
      body: JSON.stringify({ meaning: "medical_review", reauth_token: reauth }),
    });

  it("accepts a fresh re-auth token for the same subject and records oidc_fresh_token", async () => {
    const session = await mint({});
    const versionId = await fixtureVersion();
    const res = await sign(
      session,
      versionId,
      await mint({ auth_time: Math.floor(Date.now() / 1000) }),
    );
    expect(res.status).toBe(201);
    const { signature_id } = (await res.json()) as { signature_id: string };
    const [sig] = await sql`SELECT reauth_method FROM signature WHERE id = ${signature_id}`;
    expect(sig!.reauth_method).toBe("oidc_fresh_token");
  });

  it("rejects a stale re-auth token (auth_time outside the freshness window)", async () => {
    const session = await mint({});
    const versionId = await fixtureVersion();
    expect(
      (
        await sign(
          session,
          versionId,
          await mint({ auth_time: Math.floor(Date.now() / 1000) - 3600 }),
        )
      ).status,
    ).toBe(403);
  });

  it("rejects a re-auth token minted for a different subject", async () => {
    const session = await mint({});
    const versionId = await fixtureVersion();
    expect(
      (
        await sign(
          session,
          versionId,
          await mint({ auth_time: Math.floor(Date.now() / 1000) }, AUDIENCE, "someone-else"),
        )
      ).status,
    ).toBe(403);
  });
});
