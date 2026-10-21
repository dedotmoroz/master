import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { CreateBucketCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { S3ObjectStorage } from "../../src/adapters/out/storage/s3-object-storage.ts";

const endpoint = process.env.TEST_S3_ENDPOINT;

test("S3 adapter signs upload, verifies metadata, and signs download", { skip: !endpoint }, async () => {
  assert.ok(endpoint);
  const client = new S3Client({
    endpoint,
    region: "us-east-1",
    credentials: { accessKeyId: "minioadmin", secretAccessKey: "minioadmin" },
    forcePathStyle: true,
  });
  try {
    await client.send(new CreateBucketCommand({ Bucket: "naitimastera" }));
  } catch (error) {
    if (!(error instanceof S3ServiceException && error.$metadata.httpStatusCode === 409)) throw error;
  } finally {
    client.destroy();
  }
  const storage = new S3ObjectStorage({
    endpoint,
    region: "us-east-1",
    bucket: "naitimastera",
    accessKeyId: "minioadmin",
    secretAccessKey: "minioadmin",
    forcePathStyle: true,
  });
  const key = `integration/${randomUUID()}`;
  const body = Buffer.from("verified object storage payload", "utf8");

  try {
    const upload = await storage.createUploadUrl({
      key,
      contentType: "image/webp",
      sizeBytes: body.byteLength,
      expiresInSeconds: 60,
    });
    const uploaded = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body,
    });
    assert.equal(uploaded.status, 200);

    const metadata = await storage.stat(key);
    assert.deepEqual(metadata, {
      contentType: "image/webp",
      sizeBytes: body.byteLength,
    });
    assert.deepEqual(await storage.get(key, body.byteLength), body);

    const processedKey = `${key}/processed`;
    await storage.put({ key: processedKey, contentType: "image/webp", body });
    assert.deepEqual(await storage.get(processedKey, body.byteLength), body);

    const downloadUrl = await storage.createDownloadUrl({
      key,
      fileName: "фасад.webp",
      expiresInSeconds: 60,
      disposition: "inline",
    });
    const downloaded = await fetch(downloadUrl);
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), body);
    await storage.delete(key);
    await storage.delete(processedKey);
    assert.equal(await storage.stat(key), null);
  } finally {
    storage.destroy();
  }
});
