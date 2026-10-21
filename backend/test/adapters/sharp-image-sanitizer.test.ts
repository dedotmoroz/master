import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { SharpImageSanitizer } from "../../src/adapters/out/media/sharp-image-sanitizer.ts";

test("Sharp sanitizer auto-orients, bounds, and strips image metadata", async () => {
  const source = await sharp({
    create: { width: 900, height: 600, channels: 3, background: "#336699" },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

  const result = await new SharpImageSanitizer().sanitize(source);
  const safe = await sharp(result.content).metadata();
  const preview = await sharp(result.preview).metadata();

  assert.equal(result.contentType, "image/webp");
  assert.equal(safe.format, "webp");
  assert.equal(safe.orientation, undefined);
  assert.equal(safe.exif, undefined);
  assert.ok((preview.width ?? 0) <= 480);
  assert.ok((preview.height ?? 0) <= 480);
});
