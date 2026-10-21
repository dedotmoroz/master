import assert from "node:assert/strict";
import test from "node:test";
import { NotificationPreferences } from "../../src/modules/notifications/domain/notification-preferences.ts";

test("email preferences default to enabled and each event can be disabled independently", () => {
  const defaults = NotificationPreferences.defaults();
  for (const kind of ["bid_submitted", "bid_selected", "order_completed", "message_received"] as const) {
    assert.equal(defaults.allowsEmail(kind), true);
  }
  const preferences = NotificationPreferences.restore({ email: {
    bidSubmitted: false, bidSelected: true, orderCompleted: false,
  } });
  assert.equal(preferences.allowsEmail("bid_submitted"), false);
  assert.equal(preferences.allowsEmail("bid_selected"), true);
  assert.equal(preferences.allowsEmail("order_completed"), false);
  assert.equal(preferences.allowsEmail("message_received"), true);
  assert.equal(NotificationPreferences.restore({email:{bidSubmitted:true,bidSelected:true,orderCompleted:true,messageReceived:false}}).allowsEmail("message_received"),false);
});
