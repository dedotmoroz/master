import { DomainError, assertDomain } from "../../../shared/domain/domain-error.ts";
import type { Clock } from "../../marketplace/application/ports/guest-order-ports.ts";
import type {
  GuestUploadAccessPolicy,
  HumanVerification,
  PublicRateLimiter,
} from "./ports/attachment-ports.ts";

export class ProtectedGuestUploadAccess implements GuestUploadAccessPolicy {
  readonly #rateLimiter: PublicRateLimiter;
  readonly #humanVerification: HumanVerification;
  readonly #clock: Clock;
  readonly #limit: number;
  readonly #windowSeconds: number;

  constructor(dependencies: Readonly<{
    rateLimiter: PublicRateLimiter;
    humanVerification: HumanVerification;
    clock: Clock;
    limit: number;
    windowSeconds: number;
  }>) {
    this.#rateLimiter = dependencies.rateLimiter;
    this.#humanVerification = dependencies.humanVerification;
    this.#clock = dependencies.clock;
    this.#limit = dependencies.limit;
    this.#windowSeconds = dependencies.windowSeconds;
  }

  async assertAllowed(input: Readonly<{
    clientAddress: string;
    humanVerificationToken: string | null;
  }>): Promise<void> {
    assertDomain(input.clientAddress.trim().length > 0, "INVALID_CLIENT_ADDRESS", "Client address is required");
    const rate = await this.#rateLimiter.consume({
      action: "guest_attachment_upload",
      clientAddress: input.clientAddress,
      limit: this.#limit,
      windowSeconds: this.#windowSeconds,
      occurredAt: this.#clock.now(),
    });
    if (!rate.allowed) {
      throw new DomainError("RATE_LIMIT_EXCEEDED", "Too many guest upload requests", {
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }
    const verified = await this.#humanVerification.verify({
      token: input.humanVerificationToken,
      clientAddress: input.clientAddress,
      expectedAction: "guest_attachment_upload",
    });
    assertDomain(verified, "HUMAN_VERIFICATION_FAILED", "Human verification failed");
  }
}

export class AllowAllHumanVerification implements HumanVerification {
  async verify(): Promise<boolean> {
    return true;
  }
}
