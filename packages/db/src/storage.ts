import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { loadEnv } from "./env.js";

/**
 * Content-addressed blob store: files keyed by sha256, behind a driver
 * interface. `local` (default) is a dev directory; `s3` targets any
 * S3-compatible store and, when the bucket has Object Lock, extends the
 * database's immutability guarantee to the bytes themselves (WORM).
 * Select with STORAGE_DRIVER=local|s3.
 */
export interface BlobStore {
  put(bytes: Uint8Array): Promise<{ sha256: string; sizeBytes: number }>;
  get(sha256: string): Promise<Uint8Array | null>;
  has(sha256: string): Promise<boolean>;
}

export const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// --- local driver -------------------------------------------------------------

export function storageDir(): string {
  loadEnv();
  if (process.env.STORAGE_DIR) return process.env.STORAGE_DIR;
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return join(dir, "storage");
    const parent = dirname(dir);
    if (parent === dir) return join(process.cwd(), "storage");
    dir = parent;
  }
}

export function makeLocalStore(dir?: string): BlobStore {
  const root = () => dir ?? storageDir();
  return {
    async put(bytes) {
      const sha256 = sha256Of(bytes);
      mkdirSync(root(), { recursive: true });
      const path = join(root(), sha256);
      if (!existsSync(path)) writeFileSync(path, bytes);
      return { sha256, sizeBytes: bytes.byteLength };
    },
    async get(sha256) {
      const path = join(root(), sha256);
      return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
    },
    async has(sha256) {
      return existsSync(join(root(), sha256));
    },
  };
}

// --- s3 driver ------------------------------------------------------------------

export interface S3StoreConfig {
  endpoint?: string; // MinIO or non-AWS stores
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean; // required by MinIO
  // Per-object retention. Omit to rely on the bucket's default Object Lock
  // rule (typical production setup: bucket created with lock + default rule).
  objectLockMode?: "COMPLIANCE" | "GOVERNANCE";
  objectLockRetentionDays?: number;
}

export function makeS3Store(config: S3StoreConfig): BlobStore & { client: S3Client } {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    forcePathStyle: config.forcePathStyle ?? false,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  const has = async (sha256: string) => {
    try {
      await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: sha256 }));
      return true;
    } catch {
      return false;
    }
  };
  return {
    client,
    has,
    async put(bytes) {
      const sha256 = sha256Of(bytes);
      // Content-addressed: identical key means identical bytes; skip re-upload
      // (also avoids stacking retention versions of the same content).
      if (!(await has(sha256))) {
        const retention =
          config.objectLockMode && config.objectLockRetentionDays
            ? {
                ObjectLockMode: config.objectLockMode,
                ObjectLockRetainUntilDate: new Date(
                  Date.now() + config.objectLockRetentionDays * 86_400_000,
                ),
              }
            : {};
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: sha256,
            Body: bytes,
            ContentType: "application/octet-stream",
            ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
            ...retention,
          }),
        );
      }
      return { sha256, sizeBytes: bytes.byteLength };
    },
    async get(sha256) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: sha256 }));
        return res.Body ? new Uint8Array(await res.Body.transformToByteArray()) : null;
      } catch {
        return null;
      }
    },
  };
}

export function s3ConfigFromEnv(): S3StoreConfig {
  loadEnv();
  for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
    if (!process.env[key]) throw new Error(`STORAGE_DRIVER=s3 requires ${key}`);
  }
  return {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET!,
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    objectLockMode: process.env.S3_OBJECT_LOCK_MODE as S3StoreConfig["objectLockMode"],
    objectLockRetentionDays: process.env.S3_OBJECT_LOCK_RETENTION_DAYS
      ? Number(process.env.S3_OBJECT_LOCK_RETENTION_DAYS)
      : undefined,
  };
}

/** Create a bucket with Object Lock enabled (tests, first-time setup). */
export async function createLockedBucket(client: S3Client, bucket: string): Promise<void> {
  await client.send(new CreateBucketCommand({ Bucket: bucket, ObjectLockEnabledForBucket: true }));
}

// --- configured store ---------------------------------------------------------------

let store: BlobStore | null = null;

export function blobStore(): BlobStore {
  if (store) return store;
  loadEnv();
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") store = makeS3Store(s3ConfigFromEnv());
  else if (driver === "local") store = makeLocalStore();
  else throw new Error(`unknown STORAGE_DRIVER '${driver}' (expected local or s3)`);
  return store;
}

export const putBlob = (bytes: Uint8Array) => blobStore().put(bytes);
export const getBlob = (sha256: string) => blobStore().get(sha256);
export const hasBlob = (sha256: string) => blobStore().has(sha256);
