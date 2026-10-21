import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../../src/shared/domain/domain-error.ts";
import { Email, MoneyRange } from "../../src/shared/domain/value-objects.ts";
import { OrderSubmission } from "../../src/modules/marketplace/domain/order-submission.ts";

const createdAt = new Date("2026-01-01T10:00:00.000Z");
const expiresAt = new Date("2026-01-02T10:00:00.000Z");

function makeSubmission(): OrderSubmission {
  return OrderSubmission.create({
    id: "submission-1",
    email: Email.create("customer@example.com"),
    contactName: "Иван",
    draft: {
      categoryId: "category-electricity",
      locationId: "moscow",
      title: "Развести электрику в квартире",
      description: "Нужна полная разводка электрики в двухкомнатной квартире.",
      budget: MoneyRange.unspecified(),
      temporaryAttachmentIds: ["attachment-1"],
    },
    consentVersion: "2026-01",
    tokenHash: "hash-1",
    createdAt,
    expiresAt,
  });
}

test("OrderSubmission starts pending and records a domain event", () => {
  const submission = makeSubmission();
  assert.equal(submission.status, "pending_email");
  assert.equal(submission.pullEvents()[0]?.name, "GuestOrderSubmitted");
});

test("OrderSubmission confirms once and remains idempotent for the same result", () => {
  const submission = makeSubmission();
  const confirmationTime = new Date("2026-01-01T11:00:00.000Z");

  submission.confirm("account-1", "order-1", confirmationTime);
  submission.confirm("account-1", "order-1", confirmationTime);

  assert.equal(submission.status, "confirmed");
  assert.equal(submission.accountId, "account-1");
  assert.equal(submission.orderId, "order-1");
});

test("OrderSubmission cannot be confirmed after expiry", () => {
  const submission = makeSubmission();
  assert.throws(
    () => submission.confirm("account-1", "order-1", expiresAt),
    (error: unknown) => error instanceof DomainError && error.code === "SUBMISSION_EXPIRED",
  );
});

test("OrderSubmission enforces a maximum of ten attachments", () => {
  assert.throws(
    () =>
      OrderSubmission.create({
        id: "submission-2",
        email: Email.create("customer@example.com"),
        contactName: "Иван",
        draft: {
          categoryId: "category-1",
          locationId: "location-1",
          title: "Ремонт",
          description: "Нужно выполнить ремонт помещения.",
          budget: MoneyRange.unspecified(),
          temporaryAttachmentIds: Array.from({ length: 11 }, (_, index) => `attachment-${index}`),
        },
        consentVersion: "2026-01",
        tokenHash: "hash-2",
        createdAt,
        expiresAt,
      }),
    (error: unknown) => error instanceof DomainError && error.code === "TOO_MANY_ATTACHMENTS",
  );
});
