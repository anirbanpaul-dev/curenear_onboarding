import { createReadStream } from 'node:fs';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ServerEnv } from '@curenear/shared';

/**
 * Private object storage for generated exports.
 *
 * The upload body is a file stream with an explicit content length, so the file
 * is never held in memory — the same 10 MB document bucket, a different prefix.
 * Tests pass a fake implementation that records what was written.
 */
export interface ExportStorage {
  putFile(input: {
    key: string;
    filePath: string;
    sizeBytes: number;
    contentType: string;
  }): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createS3ExportStorage(env: ServerEnv, client?: S3Client): ExportStorage {
  const s3 =
    client ??
    new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });

  return {
    async putFile({ key, filePath, sizeBytes, contentType }) {
      await s3.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
          Body: createReadStream(filePath),
          ContentLength: sizeBytes,
          ContentType: contentType,
        }),
      );
    },

    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    },
  };
}
