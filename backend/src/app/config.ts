export type AppEnvironment = "development" | "test" | "production";

export type DevelopmentMailConfig = Readonly<{
  transport: "development";
}>;

export type SmtpMailConfig = Readonly<{
  transport: "smtp";
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  from: string;
}>;

export type ObjectStorageConfig = Readonly<{
  endpoint: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds: number;
}>;

export type UploadProtectionConfig = Readonly<{
  accountCleanupEnabled: boolean;
  rateLimit: number;
  rateLimitWindowSeconds: number;
  cleanupIntervalMs: number;
  cleanupBatchSize: number;
  unclaimedRetentionSeconds: number;
  humanVerification:
    | Readonly<{ provider: "disabled" }>
    | Readonly<{ provider: "turnstile"; secretKey: string; expectedHostname: string }>;
}>;

export type MalwareScannerConfig =
  | Readonly<{ provider: "disabled" }>
  | Readonly<{ provider: "clamav"; host: string; port: number; timeoutMs: number }>;

export type AuthenticationConfig = Readonly<{
  requestTtlSeconds: number;
  rateLimitPerIp: number;
  rateLimitPerEmail: number;
  rateLimitWindowSeconds: number;
}>;

export type AppConfig = Readonly<{
  environment: AppEnvironment;
  host: string;
  port: number;
  trustedProxyHops: number;
  databaseUrl: string;
  verificationTokenSecret: string;
  publicWebUrl: string;
  runMigrationsOnStart: boolean;
  outboxPollIntervalMs: number;
  outboxBatchSize: number;
  mail: DevelopmentMailConfig | SmtpMailConfig;
  storage: ObjectStorageConfig;
  uploadProtection: UploadProtectionConfig;
  malwareScanner: MalwareScannerConfig;
  authentication: AuthenticationConfig;
}>;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

function optional(environment: NodeJS.ProcessEnv, name: string): string | null {
  const value = environment[name]?.trim();
  return value ? value : null;
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = optional(environment, name);
  if (!value) throw new ConfigurationError(`${name} is required`);
  return value;
}

function integer(
  environment: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const raw = optional(environment, name);
  if (!raw) return defaultValue;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function boolean(environment: NodeJS.ProcessEnv, name: string, defaultValue: boolean): boolean {
  const raw = optional(environment, name);
  if (!raw) return defaultValue;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ConfigurationError(`${name} must be true or false`);
}

function httpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigurationError(`${name} must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigurationError(`${name} must use http or https`);
  }
  return url.toString();
}

function appEnvironment(environment: NodeJS.ProcessEnv): AppEnvironment {
  const value = optional(environment, "NODE_ENV") ?? "development";
  if (value !== "development" && value !== "test" && value !== "production") {
    throw new ConfigurationError("NODE_ENV must be development, test, or production");
  }
  return value;
}

function mailConfig(
  environment: NodeJS.ProcessEnv,
  applicationEnvironment: AppEnvironment,
): DevelopmentMailConfig | SmtpMailConfig {
  const transport = optional(environment, "MAIL_TRANSPORT")
    ?? (applicationEnvironment === "production" ? "smtp" : "development");

  if (transport === "development") {
    if (applicationEnvironment === "production") {
      throw new ConfigurationError("MAIL_TRANSPORT=development is forbidden in production");
    }
    return { transport };
  }
  if (transport !== "smtp") {
    throw new ConfigurationError("MAIL_TRANSPORT must be development or smtp");
  }

  const user = optional(environment, "SMTP_USER");
  const password = optional(environment, "SMTP_PASSWORD");
  if ((user === null) !== (password === null)) {
    throw new ConfigurationError("SMTP_USER and SMTP_PASSWORD must be configured together");
  }
  return {
    transport,
    host: required(environment, "SMTP_HOST"),
    port: integer(environment, "SMTP_PORT", 587, 1, 65_535),
    secure: boolean(environment, "SMTP_SECURE", false),
    user,
    password,
    from: required(environment, "SMTP_FROM"),
  };
}

function storageConfig(
  environment: NodeJS.ProcessEnv,
  applicationEnvironment: AppEnvironment,
): ObjectStorageConfig {
  const production = applicationEnvironment === "production";
  const endpointValue = optional(environment, "STORAGE_ENDPOINT");
  return {
    endpoint: endpointValue === null ? null : httpUrl(endpointValue, "STORAGE_ENDPOINT"),
    region: optional(environment, "STORAGE_REGION") ?? "us-east-1",
    bucket: production
      ? required(environment, "STORAGE_BUCKET")
      : optional(environment, "STORAGE_BUCKET") ?? "naitimastera",
    accessKeyId: production
      ? required(environment, "STORAGE_ACCESS_KEY_ID")
      : optional(environment, "STORAGE_ACCESS_KEY_ID") ?? "minioadmin",
    secretAccessKey: production
      ? required(environment, "STORAGE_SECRET_ACCESS_KEY")
      : optional(environment, "STORAGE_SECRET_ACCESS_KEY") ?? "minioadmin",
    forcePathStyle: boolean(environment, "STORAGE_FORCE_PATH_STYLE", !production),
    uploadUrlTtlSeconds: integer(environment, "STORAGE_UPLOAD_URL_TTL_SECONDS", 900, 60, 3_600),
    downloadUrlTtlSeconds: integer(environment, "STORAGE_DOWNLOAD_URL_TTL_SECONDS", 900, 60, 3_600),
  };
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode = appEnvironment(environment);
  const secret = required(environment, "VERIFICATION_TOKEN_SECRET");
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new ConfigurationError("VERIFICATION_TOKEN_SECRET must contain at least 32 bytes");
  }

  const publicWebUrl = httpUrl(
    optional(environment, "PUBLIC_WEB_URL")
      ?? (mode === "production" ? required(environment, "PUBLIC_WEB_URL") : "http://localhost:5173"),
    "PUBLIC_WEB_URL",
  );
  const turnstileSecret = optional(environment, "TURNSTILE_SECRET_KEY");
  if (mode === "production" && turnstileSecret === null) {
    throw new ConfigurationError("TURNSTILE_SECRET_KEY is required in production");
  }
  const malwareProvider = optional(environment, "MALWARE_SCANNER")
    ?? (mode === "production" ? "clamav" : "disabled");
  if (malwareProvider !== "disabled" && malwareProvider !== "clamav") {
    throw new ConfigurationError("MALWARE_SCANNER must be disabled or clamav");
  }
  if (mode === "production" && malwareProvider === "disabled") {
    throw new ConfigurationError("MALWARE_SCANNER=disabled is forbidden in production");
  }

  return {
    environment: mode,
    host: optional(environment, "HOST") ?? "0.0.0.0",
    port: integer(environment, "PORT", 3000, 1, 65_535),
    trustedProxyHops: integer(environment, "TRUST_PROXY_HOPS", 0, 0, 10),
    databaseUrl: required(environment, "DATABASE_URL"),
    verificationTokenSecret: secret,
    publicWebUrl,
    runMigrationsOnStart: boolean(environment, "RUN_MIGRATIONS_ON_START", false),
    outboxPollIntervalMs: integer(environment, "OUTBOX_POLL_INTERVAL_MS", 1_000, 100, 60_000),
    outboxBatchSize: integer(environment, "OUTBOX_BATCH_SIZE", 20, 1, 1_000),
    mail: mailConfig(environment, mode),
    storage: storageConfig(environment, mode),
    uploadProtection: {
      rateLimit: integer(environment, "GUEST_UPLOAD_RATE_LIMIT", 10, 1, 10_000),
      rateLimitWindowSeconds: integer(environment, "GUEST_UPLOAD_RATE_LIMIT_WINDOW_SECONDS", 900, 1, 86_400),
      accountCleanupEnabled: boolean(environment, "ACCOUNT_ATTACHMENT_CLEANUP_ENABLED", false),
      cleanupIntervalMs: integer(environment, "ATTACHMENT_CLEANUP_INTERVAL_MS", 60_000, 1_000, 86_400_000),
      cleanupBatchSize: integer(environment, "ATTACHMENT_CLEANUP_BATCH_SIZE", 100, 1, 1_000),
      unclaimedRetentionSeconds: integer(environment, "GUEST_ATTACHMENT_RETENTION_SECONDS", 86_400, 3_600, 604_800),
      humanVerification: turnstileSecret === null
        ? { provider: "disabled" }
        : {
            provider: "turnstile",
            secretKey: turnstileSecret,
            expectedHostname: optional(environment, "TURNSTILE_EXPECTED_HOSTNAME")
              ?? new URL(publicWebUrl).hostname,
          },
    },
    malwareScanner: malwareProvider === "clamav"
      ? {
          provider: "clamav",
          host: optional(environment, "CLAMAV_HOST") ?? "127.0.0.1",
          port: integer(environment, "CLAMAV_PORT", 3310, 1, 65_535),
          timeoutMs: integer(environment, "CLAMAV_TIMEOUT_MS", 30_000, 1_000, 120_000),
        }
      : { provider: "disabled" },
    authentication: {
      requestTtlSeconds: integer(environment, "AUTH_LINK_TTL_SECONDS", 900, 60, 3_600),
      rateLimitPerIp: integer(environment, "AUTH_RATE_LIMIT_PER_IP", 20, 1, 10_000),
      rateLimitPerEmail: integer(environment, "AUTH_RATE_LIMIT_PER_EMAIL", 5, 1, 1_000),
      rateLimitWindowSeconds: integer(environment, "AUTH_RATE_LIMIT_WINDOW_SECONDS", 900, 60, 86_400),
    },
  };
}
