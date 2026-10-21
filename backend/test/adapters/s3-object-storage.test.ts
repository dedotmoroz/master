import assert from "node:assert/strict";
import test from "node:test";
import { S3ObjectStorage } from "../../src/adapters/out/storage/s3-object-storage.ts";

test("S3 adapter creates SigV4 upload and download URLs without exposing credentials", async () => {
  const storage = new S3ObjectStorage({
    endpoint: "http://127.0.0.1:59000",
    region: "us-east-1",
    bucket: "naitimastera",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    forcePathStyle: true,
  });

  try {
    const upload = await storage.createUploadUrl({
      key: "attachments/account-1/attachment-1",
      contentType: "image/webp",
      sizeBytes: 1_024,
      expiresInSeconds: 900,
    });
    const download = await storage.createDownloadUrl({
      key: "attachments/account-1/attachment-1",
      fileName: "фасад.webp",
      expiresInSeconds: 900,
      disposition: "inline",
    });

    assert.ok(upload.url.startsWith("http://127.0.0.1:59000/naitimastera/attachments/"));
    assert.ok(upload.url.includes("X-Amz-Signature="));
    assert.equal(upload.url.includes("test-secret-key"), false);
    assert.equal(upload.url.includes("x-amz-checksum"), false);
    assert.deepEqual(upload.headers, { "content-type": "image/webp" });
    assert.ok(download.includes("response-content-disposition="));
    assert.ok(download.includes("X-Amz-Signature="));
  } finally {
    storage.destroy();
  }
});
