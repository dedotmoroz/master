import { DomainError } from "../../../shared/domain/domain-error.ts";
import type { Email } from "../../../shared/domain/value-objects.ts";
import type { PublicRateLimiter } from "../../attachments/application/ports/attachment-ports.ts";
import type { Clock } from "../../marketplace/application/ports/guest-order-ports.ts";
import type { AuthenticationRequestAccessPolicy } from "./ports/authentication-ports.ts";

export class RateLimitedAuthenticationRequestAccess implements AuthenticationRequestAccessPolicy {
  readonly #rateLimiter: PublicRateLimiter;
  readonly #clock: Clock;
  readonly #ipLimit: number;
  readonly #emailLimit: number;
  readonly #windowSeconds: number;

  constructor(dependencies: Readonly<{
    rateLimiter: PublicRateLimiter;
    clock: Clock;
    ipLimit: number;
    emailLimit: number;
    windowSeconds: number;
  }>) {
    this.#rateLimiter = dependencies.rateLimiter;
    this.#clock = dependencies.clock;
    this.#ipLimit = dependencies.ipLimit;
    this.#emailLimit = dependencies.emailLimit;
    this.#windowSeconds = dependencies.windowSeconds;
  }

  async assertAllowed(input: Readonly<{ clientAddress: string; email: Email }>): Promise<void> {
    const occurredAt = this.#clock.now();
    const ip = await this.#rateLimiter.consume({
      action: "email_auth_ip",
      clientAddress: input.clientAddress,
      limit: this.#ipLimit,
      windowSeconds: this.#windowSeconds,
      occurredAt,
    });
    if (!ip.allowed) throw new DomainError("RATE_LIMIT_EXCEEDED", "Too many authentication requests", { retryAfterSeconds: ip.retryAfterSeconds });

    const email = await this.#rateLimiter.consume({
      action: "email_auth_email",
      clientAddress: input.email.value,
      limit: this.#emailLimit,
      windowSeconds: this.#windowSeconds,
      occurredAt,
    });
    if (!email.allowed) throw new DomainError("RATE_LIMIT_EXCEEDED", "Too many authentication requests", { retryAfterSeconds: email.retryAfterSeconds });
  }
}
