import assert from "node:assert/strict";
import test from "node:test";
import { TurnstileHumanVerification } from "../../src/adapters/out/security/turnstile-human-verification.ts";

test("Turnstile verifier checks success, hostname, and action server-side", async () => {
  let submittedBody = "";
  const verifier = new TurnstileHumanVerification({
    secretKey: "turnstile-secret",
    expectedHostname: "naitimastera.ru",
    fetch: async (_input, init) => {
      submittedBody = String(init?.body);
      return new Response(JSON.stringify({
        success: true,
        hostname: "naitimastera.ru",
        action: "guest_attachment_upload",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(await verifier.verify({
    token: "browser-proof",
    clientAddress: "203.0.113.10",
    expectedAction: "guest_attachment_upload",
  }), true);
  assert.match(submittedBody, /secret=turnstile-secret/);
  assert.match(submittedBody, /response=browser-proof/);
  assert.match(submittedBody, /remoteip=203.0.113.10/);
});

test("Turnstile verifier fails closed for missing tokens and mismatched hostnames", async () => {
  let calls = 0;
  const verifier = new TurnstileHumanVerification({
    secretKey: "turnstile-secret",
    expectedHostname: "naitimastera.ru",
    fetch: async () => {
      calls += 1;
      return new Response(JSON.stringify({
        success: true,
        hostname: "attacker.example",
        action: "guest_attachment_upload",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(await verifier.verify({
    token: null,
    clientAddress: "203.0.113.10",
    expectedAction: "guest_attachment_upload",
  }), false);
  assert.equal(calls, 0);
  assert.equal(await verifier.verify({
    token: "proof",
    clientAddress: "203.0.113.10",
    expectedAction: "guest_attachment_upload",
  }), false);
});
