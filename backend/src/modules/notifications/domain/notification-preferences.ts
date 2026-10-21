import { assertDomain } from "../../../shared/domain/domain-error.ts";
import type { NotificationKind } from "./notification.ts";

export type NotificationPreferencesSnapshot = Readonly<{
  email: Readonly<{ bidSubmitted: boolean; bidSelected: boolean; orderCompleted: boolean; messageReceived: boolean }>;
}>;
export type NotificationPreferencesInput = Readonly<{ email: Omit<NotificationPreferencesSnapshot["email"], "messageReceived"> & { messageReceived?: boolean } }>;

export class NotificationPreferences {
  readonly #snapshot: NotificationPreferencesSnapshot;

  private constructor(snapshot: NotificationPreferencesInput) {
    assertDomain(
      typeof snapshot.email.bidSubmitted === "boolean"
        && typeof snapshot.email.bidSelected === "boolean"
        && typeof snapshot.email.orderCompleted === "boolean"
        && (snapshot.email.messageReceived === undefined || typeof snapshot.email.messageReceived === "boolean"),
      "INVALID_NOTIFICATION_PREFERENCES", "Email notification preferences must be booleans",
    );
    this.#snapshot = Object.freeze({ email: Object.freeze({ ...snapshot.email, messageReceived: snapshot.email.messageReceived ?? true }) });
  }

  static defaults(): NotificationPreferences {
    return new NotificationPreferences({ email: { bidSubmitted: true, bidSelected: true, orderCompleted: true } });
  }

  static restore(snapshot: NotificationPreferencesInput): NotificationPreferences {
    return new NotificationPreferences(snapshot);
  }

  allowsEmail(kind: NotificationKind): boolean {
    switch (kind) {
      case "bid_submitted": return this.#snapshot.email.bidSubmitted;
      case "bid_selected": return this.#snapshot.email.bidSelected;
      case "order_completed": return this.#snapshot.email.orderCompleted;
      case "message_received": return this.#snapshot.email.messageReceived;
    }
  }

  toSnapshot(): NotificationPreferencesSnapshot { return this.#snapshot; }
}
