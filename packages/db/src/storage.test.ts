import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLockedBucket, makeLocalStore, makeS3Store, sha256Of } from "./storage.js";

/**
 * Content-addressed blob store (ADR-0013): the sha256 is the key; identical
 * bytes deduplicate; the s3 driver extends immutability to the bytes when the
 * bucket has Object Lock. The s3 tests run only when MinIO from docker-compose
 * answers (S3_ENDPOINT or localhost:9002).
 */

describe("local blob store (ADR-0013, §11.10(b))", () => {
  const dir = mkdtempSync(join(tmpdir(), "pv-store-"));
  const store = makeLocalStore(dir);

  it("stores by sha256 and reads back identical bytes", async () => {
    const bytes = new TextEncoder().encode("SAE narrative bytes");
    const { sha256, sizeBytes } = await store.put(bytes);
    expect(sha256).toBe(sha256Of(bytes));
    expect(sizeBytes).toBe(bytes.byteLength);
    expect(await store.has(sha256)).toBe(true);
    expect(new TextDecoder().decode((await store.get(sha256))!)).toBe("SAE narrative bytes");
  });

  it("deduplicates identical content and misses unknown hashes", async () => {
    const bytes = new TextEncoder().encode("same");
    const a = await store.put(bytes);
    const b = await store.put(bytes);
    expect(a.sha256).toBe(b.sha256);
    expect(await store.get("0".repeat(64))).toBeNull();
  });
});

const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9002";
const minioUp = await fetch(`${endpoint}/minio/health/live`)
  .then((r) => r.ok)
  .catch(() => false);

describe.skipIf(!minioUp)("s3 blob store with Object Lock (WORM, ADR-0013)", () => {
  const bucket = `pv-test-${Date.now()}`;
  const store = makeS3Store({
    endpoint,
    region: "us-east-1",
    bucket,
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "pvminio",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "pv-minio-dev",
    forcePathStyle: true,
    objectLockMode: "COMPLIANCE",
    objectLockRetentionDays: 1,
  });

  it("creates a locked bucket, stores, and reads back", async () => {
    await createLockedBucket(store.client, bucket);
    const bytes = new TextEncoder().encode("locked bytes");
    const { sha256 } = await store.put(bytes);
    expect(await store.has(sha256)).toBe(true);
    expect(new TextDecoder().decode((await store.get(sha256))!)).toBe("locked bytes");
  });
});
