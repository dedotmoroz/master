import type { HumanVerification } from "../../../modules/attachments/application/ports/attachment-ports.ts";

type TurnstileResponse = Readonly<{
  success?: boolean;
  hostname?: string;
  action?: string;
}>;

export class TurnstileHumanVerification implements HumanVerification {
  readonly #secretKey: string;
  readonly #expectedHostname: string;
  readonly #fetch: typeof fetch;

  constructor(input: Readonly<{
    secretKey: string;
    expectedHostname: string;
    fetch?: typeof fetch;
  }>) {
    this.#secretKey = input.secretKey;
    this.#expectedHostname = input.expectedHostname;
    this.#fetch = input.fetch ?? fetch;
  }

  async verify(input: Readonly<{
    token: string | null;
    clientAddress: string;
    expectedAction: string;
  }>): Promise<boolean> {
    if (!input.token || input.token.length > 2_048) return false;
    const response = await this.#fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: this.#secretKey,
          response: input.token,
          remoteip: input.clientAddress,
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return false;
    const result = await response.json() as TurnstileResponse;
    return result.success === true
      && result.hostname === this.#expectedHostname
      && result.action === input.expectedAction;
  }
}
