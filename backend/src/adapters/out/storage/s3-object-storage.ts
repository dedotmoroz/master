import {
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ObjectSizeLimitExceededError,
  type ObjectStorage,
} from "../../../modules/attachments/application/ports/attachment-ports.ts";

export type S3ObjectStorageConfig = Readonly<{
  endpoint: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}>;

export class S3ObjectStorage implements ObjectStorage {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(config: S3ObjectStorageConfig) {
    const clientConfig: S3ClientConfig = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
      requestChecksumCalculation: "WHEN_REQUIRED",
      ...(config.endpoint === null ? {} : { endpoint: config.endpoint }),
    };
    this.#client = new S3Client(clientConfig);
    this.#bucket = config.bucket;
  }

  async createUploadUrl(input: Readonly<{
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }>): Promise<Readonly<{ url: string; headers: Readonly<Record<string, string>> }>> {
    const command = new PutObjectCommand({
      Bucket: this.#bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
    });
    const url = await getSignedUrl(this.#client, command, { expiresIn: input.expiresInSeconds });
    return { url, headers: { "content-type": input.contentType } };
  }

  async stat(key: string): Promise<Readonly<{ contentType: string; sizeBytes: number }> | null> {
    try {
      const result = await this.#client.send(new HeadObjectCommand({
        Bucket: this.#bucket,
        Key: key,
      }));
      if (result.ContentType === undefined || result.ContentLength === undefined) return null;
      return { contentType: result.ContentType, sizeBytes: result.ContentLength };
    } catch (error) {
      if (
        error instanceof NotFound
        || (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
      ) return null;
      throw error;
    }
  }

  async get(key: string, maximumBytes: number): Promise<Buffer> {
    const result = await this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: key }));
    if (!result.Body) throw new Error(`Object body is missing: ${key}`);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > maximumBytes) {
        throw new ObjectSizeLimitExceededError();
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, total);
  }

  async put(input: Readonly<{ key: string; contentType: string; body: Buffer }>): Promise<void> {
    await this.#client.send(new PutObjectCommand({
      Bucket: this.#bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.body.byteLength,
      Body: input.body,
    }));
  }

  async createDownloadUrl(input: Readonly<{
    key: string;
    fileName: string;
    expiresInSeconds: number;
    disposition: "inline" | "attachment";
  }>): Promise<string> {
    const safeName = input.fileName.replace(/[^\p{L}\p{N}._ -]/gu, "_") || "download";
    const command = new GetObjectCommand({
      Bucket: this.#bucket,
      Key: input.key,
      ResponseContentDisposition: `${input.disposition}; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    });
    return getSignedUrl(this.#client, command, { expiresIn: input.expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }

  destroy(): void {
    this.#client.destroy();
  }
}
