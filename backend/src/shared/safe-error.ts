// Do not serialize messages, stacks, causes or provider responses: they may contain PII/secrets.
const codes = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE",
  "EADDRINUSE", "EADDRNOTAVAIL", "EACCES",
  "EAUTH", "ECONNECTION", "ESOCKET", "ETLS", "EMESSAGE", "EENVELOPE",
  "23505", "23503", "40001", "40P01", "53300", "57014", "57P01",
]);
const names = new Set(["Error", "TypeError", "RangeError", "AbortError", "TimeoutError", "DomainError",
  "NoSuchKey", "NoSuchBucket", "AccessDenied", "S3ServiceException"]);

export function safeError(error: unknown): { type: string; code?: string } {
  if (!(error instanceof Error)) return { type: "UnknownError" };
  const code = "code" in error && typeof error.code === "string" && codes.has(error.code)
    ? error.code : undefined;
  return { type: names.has(error.name) ? error.name : "Error", ...(code ? { code } : {}) };
}

export function safeErrorReason(error: unknown): string {
  const { type, code } = safeError(error);
  return code ? `${type}:${code}` : type;
}
