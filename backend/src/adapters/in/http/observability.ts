import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { safeError } from "../../../shared/safe-error.ts";

// Allowlist instead of redaction: query strings, headers, bodies, IPs and raw paths never enter logs.
export const httpLogSerializers = {
  req: (request: FastifyRequest) => ({ method: request.method }),
  res: (reply: { statusCode: number }) => ({ statusCode: reply.statusCode }),
  err: (error: unknown) => ({ ...safeError(error), message: "[redacted]", stack: "[redacted]" }),
};

export const newRequestId = (): string => randomUUID();

export function registerRequestObservability(server: FastifyInstance): void {
  server.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  server.addHook("onResponse", async (request, reply) => {
    request.log.info({
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime * 100) / 100,
    }, "Request completed");
  });
}

export async function checkWithTimeout(check: () => Promise<void>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(check),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Readiness timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
