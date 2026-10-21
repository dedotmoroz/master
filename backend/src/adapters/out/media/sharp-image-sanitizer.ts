import sharp from "sharp";
import type { ImageSanitizer, SanitizedImage } from "../../../modules/attachments/application/ports/attachment-ports.ts";

export class SharpImageSanitizer implements ImageSanitizer {
  async sanitize(content: Buffer): Promise<SanitizedImage> {
    const image = sharp(content, { failOn: "error", limitInputPixels: 40_000_000 }).autoOrient();
    const safe = await image
      .clone()
      .resize({ width: 2_560, height: 2_560, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    const preview = await image
      .clone()
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return { content: safe, preview, contentType: "image/webp" };
  }
}
