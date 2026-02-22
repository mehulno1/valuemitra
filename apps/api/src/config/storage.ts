import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import * as path from 'path';
import { env } from './env.js';

// ─────────────────────────────────────────────
// Storage abstraction — local (dev) vs S3 (prod)
// ─────────────────────────────────────────────

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.AWS_REGION,
      credentials: env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
        : undefined, // Uses instance profile on EC2
    });
  }
  return s3Client;
}

export async function uploadFile(
  buffer: Buffer,
  storagePath: string,
  mimeType: string,
): Promise<string> {
  if (env.STORAGE_PROVIDER === 's3') {
    await getS3Client().send(new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: storagePath,
      Body: buffer,
      ContentType: mimeType,
    }));
    return storagePath;
  }

  // Local storage
  const fullPath = path.join(env.LOCAL_UPLOAD_PATH, storagePath);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, buffer);
  return storagePath;
}

export async function getSignedDownloadUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  if (env.STORAGE_PROVIDER === 's3') {
    const command = new GetObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: storagePath,
    });
    return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });
  }

  // For local dev, return a path that the API will serve
  return `/api/files/${storagePath}`;
}

export async function getFileBuffer(storagePath: string): Promise<Buffer> {
  if (env.STORAGE_PROVIDER === 's3') {
    const response = await getS3Client().send(new GetObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: storagePath,
    }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  const fullPath = path.join(env.LOCAL_UPLOAD_PATH, storagePath);
  return fs.promises.readFile(fullPath);
}

export async function deleteFile(storagePath: string): Promise<void> {
  if (env.STORAGE_PROVIDER === 's3') {
    await getS3Client().send(new DeleteObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: storagePath,
    }));
    return;
  }

  const fullPath = path.join(env.LOCAL_UPLOAD_PATH, storagePath);
  await fs.promises.unlink(fullPath).catch(() => { /* ignore if not exists */ });
}

// Ensure local upload directories exist
if (env.STORAGE_PROVIDER === 'local') {
  const dirs = [
    env.LOCAL_UPLOAD_PATH,
    path.join(env.LOCAL_UPLOAD_PATH, 'uploads'),
    path.join(env.LOCAL_UPLOAD_PATH, 'reports'),
    path.join(env.LOCAL_UPLOAD_PATH, 'templates'),
  ];
  dirs.forEach(dir => fs.mkdirSync(dir, { recursive: true }));
}
