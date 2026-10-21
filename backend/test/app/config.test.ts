import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError, loadConfig } from "../../src/app/config.ts";

const baseEnvironment = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://user:password@localhost/database",
  VERIFICATION_TOKEN_SECRET: "a-secret-containing-at-least-32-bytes",
};

test("development config uses safe local defaults", () => {
  const config = loadConfig(baseEnvironment);

  assert.equal(config.port, 3000);
  assert.equal(config.publicWebUrl, "http://localhost:5173/");
  assert.equal(config.runMigrationsOnStart, false);
  assert.deepEqual(config.mail, { transport: "development" });
  assert.equal(config.storage.bucket, "naitimastera");
  assert.equal(config.storage.forcePathStyle, true);
  assert.equal(config.uploadProtection.rateLimit, 10);
  assert.equal(config.uploadProtection.accountCleanupEnabled, false);
  assert.equal(loadConfig({...baseEnvironment,ACCOUNT_ATTACHMENT_CLEANUP_ENABLED:'true'}).uploadProtection.accountCleanupEnabled, true);
  assert.deepEqual(config.uploadProtection.humanVerification, { provider: "disabled" });
  assert.deepEqual(config.malwareScanner, { provider: "disabled" });
  assert.equal(config.authentication.requestTtlSeconds, 900);
  assert.equal(config.authentication.rateLimitPerEmail, 5);
});

test("production config requires SMTP and a public web URL", () => {
  assert.throws(
    () => loadConfig({ ...baseEnvironment, NODE_ENV: "production" }),
    (error: unknown) => error instanceof ConfigurationError
      && error.message === "PUBLIC_WEB_URL is required",
  );
});

test("production config rejects development email transport", () => {
  assert.throws(
    () => loadConfig({
      ...baseEnvironment,
      NODE_ENV: "production",
      PUBLIC_WEB_URL: "https://naitimastera.example",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      MAIL_TRANSPORT: "development",
    }),
    (error: unknown) => error instanceof ConfigurationError
      && error.message.includes("forbidden"),
  );
});

test("SMTP credentials must be supplied as a pair", () => {
  assert.throws(
    () => loadConfig({
      ...baseEnvironment,
      MAIL_TRANSPORT: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "no-reply@example.com",
      SMTP_USER: "mailer",
    }),
    (error: unknown) => error instanceof ConfigurationError
      && error.message.includes("configured together"),
  );
});

test("production requires object storage credentials", () => {
  assert.throws(
    () => loadConfig({
      ...baseEnvironment,
      NODE_ENV: "production",
      PUBLIC_WEB_URL: "https://naitimastera.example",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      SMTP_HOST: "smtp.example.com",
      SMTP_FROM: "no-reply@example.com",
    }),
    (error: unknown) => error instanceof ConfigurationError
      && error.message === "STORAGE_BUCKET is required",
  );
});

test("production requires Turnstile and binds verification to the public hostname", () => {
  const productionEnvironment = {
    ...baseEnvironment,
    NODE_ENV: "production",
    PUBLIC_WEB_URL: "https://naitimastera.ru",
    SMTP_HOST: "smtp.example.com",
    SMTP_FROM: "no-reply@example.com",
    STORAGE_BUCKET: "production-files",
    STORAGE_ACCESS_KEY_ID: "access-key",
    STORAGE_SECRET_ACCESS_KEY: "secret-key",
  };
  assert.throws(
    () => loadConfig(productionEnvironment),
    (error: unknown) => error instanceof ConfigurationError
      && error.message === "TURNSTILE_SECRET_KEY is required in production",
  );

  const config = loadConfig({ ...productionEnvironment, TURNSTILE_SECRET_KEY: "turnstile-secret" });
  assert.deepEqual(config.uploadProtection.humanVerification, {
    provider: "turnstile",
    secretKey: "turnstile-secret",
    expectedHostname: "naitimastera.ru",
  });
  assert.deepEqual(config.malwareScanner, {
    provider: "clamav",
    host: "127.0.0.1",
    port: 3310,
    timeoutMs: 30_000,
  });
  assert.throws(
    () => loadConfig({
      ...productionEnvironment,
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      MALWARE_SCANNER: "disabled",
    }),
    (error: unknown) => error instanceof ConfigurationError
      && error.message === "MALWARE_SCANNER=disabled is forbidden in production",
  );
});
