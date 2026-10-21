import type { ImageSanitizer, MalwareScanner } from "../../src/modules/attachments/application/ports/attachment-ports.ts";
import type { AttachmentPurpose } from "../../src/modules/attachments/domain/attachment.ts";

export async function prepareLegacyFile(content: Buffer, purpose: AttachmentPurpose,
  scanner: MalwareScanner, images: ImageSanitizer): Promise<{ body: Buffer; preview: Buffer | null; type: string }> {
  const limit = purpose === "profile_avatar" ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
  if (!content.length || content.length > limit) throw new Error("SKIP_FILE_SIZE");
  const result = await scanner.scan(content);
  if (!result.clean) throw new Error("SKIP_MALWARE_DETECTED");
  if (content.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    if (purpose === "profile_avatar") throw new Error("SKIP_AVATAR_TYPE");
    return { body: content, preview: null, type: "application/pdf" };
  }
  const raster = content.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    || content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || ["GIF87a", "GIF89a"].includes(content.subarray(0, 6).toString("ascii"))
    || (content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP");
  if (!raster) throw new Error("SKIP_UNSUPPORTED_OR_INVALID_IMAGE");
  let sanitized;
  try { sanitized = await images.sanitize(content); }
  catch { throw new Error("SKIP_UNSUPPORTED_OR_INVALID_IMAGE"); }
  if (!sanitized.content.length || sanitized.content.length > limit) throw new Error("SKIP_FILE_SIZE");
  return { body: sanitized.content, preview: sanitized.preview, type: sanitized.contentType };
}
