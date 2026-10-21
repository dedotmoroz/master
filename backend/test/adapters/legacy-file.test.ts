import assert from "node:assert/strict";
import test from "node:test";
import { prepareLegacyFile } from "../../scripts/legacy/prepare-file.ts";

test("legacy files are scanned before decoding and only sanitized images are returned", async () => {
  const steps: string[] = [];
  const result = await prepareLegacyFile(Buffer.from([255, 216, 255, 0]), "order",
    { scan: async () => { steps.push("scan"); return { clean: true }; } },
    { sanitize: async () => { steps.push("decode"); return { content: Buffer.from("safe"), preview: Buffer.from("preview"), contentType: "image/webp" }; } });
  assert.deepEqual(steps, ["scan", "decode"]);
  assert.equal(result.body.toString(), "safe");
});

test("legacy files fail closed on scanner outages, malware, invalid images and PDF avatars", async () => {
  const clean = { scan: async () => ({ clean: true as const }) };
  const unused = { sanitize: async (): Promise<never> => { throw new Error("decoder called"); } };
  await assert.rejects(prepareLegacyFile(Buffer.from("source"), "order", { scan: async () => { throw new Error("scanner offline"); } }, unused), /scanner offline/);
  await assert.rejects(prepareLegacyFile(Buffer.from("source"), "order", { scan: async () => ({ clean: false as const, threat: "malware" }) }, unused), /SKIP_MALWARE/);
  await assert.rejects(prepareLegacyFile(Buffer.from("source"), "order", clean, unused), /SKIP_UNSUPPORTED/);
  await assert.rejects(prepareLegacyFile(Buffer.from("%PDF-1.4"), "profile_avatar", clean, unused), /SKIP_AVATAR_TYPE/);
  const pdf = await prepareLegacyFile(Buffer.from("%PDF-1.4"), "order", clean, unused);
  assert.equal(pdf.type, "application/pdf");
  assert.equal(pdf.preview, null);
});
