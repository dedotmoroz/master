import { CreateBucketCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { loadConfig } from "../src/app/config.ts";

const config = loadConfig();
const client = new S3Client({
  region: config.storage.region,
  credentials: {
    accessKeyId: config.storage.accessKeyId,
    secretAccessKey: config.storage.secretAccessKey,
  },
  forcePathStyle: config.storage.forcePathStyle,
  ...(config.storage.endpoint === null ? {} : { endpoint: config.storage.endpoint }),
});

try {
  await client.send(new CreateBucketCommand({ Bucket: config.storage.bucket }));
  console.log(`Created object storage bucket: ${config.storage.bucket}`);
} catch (error) {
  if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 409) {
    console.log(`Object storage bucket already exists: ${config.storage.bucket}`);
  } else {
    throw error;
  }
} finally {
  client.destroy();
}
