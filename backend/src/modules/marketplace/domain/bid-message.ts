import { assertDomain } from "../../../shared/domain/domain-error.ts";
import { assertEntityId, assertNonBlank } from "../../../shared/domain/value-objects.ts";

export type BidMessageSnapshot = Readonly<{
  id: string; bidId: string; orderId: string; authorId: string; clientMessageId: string; text: string; createdAt: Date;
}>;

export class BidMessage {
  readonly #snapshot: BidMessageSnapshot;
  private constructor(snapshot: BidMessageSnapshot) {
    assertDomain(Number.isFinite(snapshot.createdAt.getTime()), "INVALID_MESSAGE_DATE", "Message date is invalid");
    this.#snapshot = Object.freeze({ ...snapshot, id: assertEntityId(snapshot.id, "messageId"),
      bidId: assertEntityId(snapshot.bidId, "bidId"), orderId: assertEntityId(snapshot.orderId, "orderId"),
      authorId: assertEntityId(snapshot.authorId, "authorId"), clientMessageId: BidMessage.normalizeClientId(snapshot.clientMessageId),
      text: BidMessage.normalizeText(snapshot.text), createdAt: new Date(snapshot.createdAt) });
  }
  static normalizeClientId(value: string): string {
    assertDomain(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
      "INVALID_CLIENT_MESSAGE_ID", "clientMessageId must be a UUID");
    return value.toLowerCase();
  }
  static normalizeText(value: string): string {
    assertDomain(!value.includes("\0"), "INVALID_MESSAGE_TEXT", "Message contains an invalid character");
    return assertNonBlank(value, "text", 5000);
  }
  static create(snapshot: BidMessageSnapshot): BidMessage { return new BidMessage(snapshot); }
  static restore(snapshot: BidMessageSnapshot): BidMessage { return new BidMessage(snapshot); }
  toSnapshot(): BidMessageSnapshot { return { ...this.#snapshot, createdAt: new Date(this.#snapshot.createdAt) }; }
}
