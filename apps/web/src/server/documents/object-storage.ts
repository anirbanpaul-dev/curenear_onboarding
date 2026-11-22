import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getServerEnv } from '@curenear/shared';
import { getStorageClient } from '@/server/storage';

/**
 * The document service never proxies file bytes itself: the browser PUTs to a
 * presigned URL, and downloads are short-lived presigned GETs. Keeping the port
 * this small makes it trivial to swap in another S3-compatible store in tests.
 */
export interface ObjectStorage {
  createUploadUrl(input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<string>;
  createDownloadUrl(input: { key: string; expiresInSeconds: number }): Promise<string>;
  /** Reads the whole object; documents are capped at 10 MB, so this is cheap. */
  read(key: string): Promise<{ bytes: Uint8Array; size: number } | null>;
  delete(key: string): Promise<void>;
}

function isMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    record.name === 'NoSuchKey' ||
    record.name === 'NotFound' ||
    record.$metadata?.httpStatusCode === 404
  );
}

export function createS3ObjectStorage(
  client: S3Client = getStorageClient(),
  bucket: string = getServerEnv().S3_BUCKET,
): ObjectStorage {
  return {
    createUploadUrl({ key, contentType, expiresInSeconds }) {
      return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
        { expiresIn: expiresInSeconds },
      );
    },

    createDownloadUrl({ key, expiresInSeconds }) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    },

    async read(key) {
      try {
        const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!object.Body) return null;
        const bytes = await object.Body.transformToByteArray();
        return { bytes, size: bytes.byteLength };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
