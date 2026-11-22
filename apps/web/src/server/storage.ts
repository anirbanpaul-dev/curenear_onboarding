import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { getServerEnv, type ServerEnv } from '@curenear/shared';

let cachedClient: S3Client | null = null;

/**
 * S3-compatible storage (MinIO in local development). Documents themselves are
 * never proxied through the app; only presigned URLs / metadata will use this.
 */
export function getStorageClient(env: ServerEnv = getServerEnv()): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return cachedClient;
}

/** Throws when the bucket cannot be reached; used by /api/ready. */
export async function checkStorage(timeoutMs = 3000): Promise<void> {
  const env = getServerEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await getStorageClient(env).send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }), {
      abortSignal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Test hook so a fresh client is built after environment changes. */
export function resetStorageClient(): void {
  cachedClient = null;
}
