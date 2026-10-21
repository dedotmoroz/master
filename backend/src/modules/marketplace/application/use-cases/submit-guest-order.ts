import { Email, Money, MoneyRange } from "../../../../shared/domain/value-objects.ts";
import { OrderSubmission } from "../../domain/order-submission.ts";
import type {
  GuestAttachmentClaim,
  GuestAttachmentClaims,
} from "../../../attachments/application/ports/attachment-ports.ts";
import type {
  Clock,
  IdGenerator,
  OrderSubmissionRepository,
  TransactionManager,
  VerificationTokenService,
} from "../ports/guest-order-ports.ts";
import type { WorkCategorySelectionPolicy } from "../../../catalog/application/ports/work-category-ports.ts";
import type { RussianLocationSelectionPolicy } from "../../../geography/application/ports/russian-location-ports.ts";

export type SubmitGuestOrderCommand = Readonly<{
  email: string;
  contactName: string;
  categoryId: string;
  locationId: string;
  title: string;
  description: string;
  budgetMinMinor: number | null;
  budgetMaxMinor: number | null;
  temporaryAttachments?: readonly GuestAttachmentClaim[];
  consentVersion: string;
}>;

export type SubmitGuestOrderResult = Readonly<{
  submissionId: string;
  expiresAt: Date;
}>;

export class SubmitGuestOrderHandler {
  readonly #submissions: OrderSubmissionRepository;
  readonly #tokens: VerificationTokenService;
  readonly #ids: IdGenerator;
  readonly #clock: Clock;
  readonly #transactions: TransactionManager;
  readonly #guestAttachments: GuestAttachmentClaims;
  readonly #categories: WorkCategorySelectionPolicy;
  readonly #locations: RussianLocationSelectionPolicy;
  readonly #confirmationTtlMs: number;

  constructor(dependencies: Readonly<{
    submissions: OrderSubmissionRepository;
    tokens: VerificationTokenService;
    ids: IdGenerator;
    clock: Clock;
    transactions: TransactionManager;
    guestAttachments: GuestAttachmentClaims;
    categories: WorkCategorySelectionPolicy;
    locations: RussianLocationSelectionPolicy;
    confirmationTtlMs?: number;
  }>) {
    this.#submissions = dependencies.submissions;
    this.#tokens = dependencies.tokens;
    this.#ids = dependencies.ids;
    this.#clock = dependencies.clock;
    this.#transactions = dependencies.transactions;
    this.#guestAttachments = dependencies.guestAttachments;
    this.#categories = dependencies.categories;
    this.#locations = dependencies.locations;
    this.#confirmationTtlMs = dependencies.confirmationTtlMs ?? 24 * 60 * 60 * 1_000;
  }

  async execute(command: SubmitGuestOrderCommand): Promise<SubmitGuestOrderResult> {
    await this.#categories.assertSelectable([command.categoryId]);
    await this.#locations.assertSelectable([command.locationId]);
    const now = this.#clock.now();
    const expiresAt = new Date(now.getTime() + this.#confirmationTtlMs);
    const email = Email.create(command.email);
    const submissionId = this.#ids.next();
    const issuedToken = this.#tokens.issue(submissionId);
    const budget = MoneyRange.create(
      command.budgetMinMinor === null ? null : Money.fromMinor(command.budgetMinMinor),
      command.budgetMaxMinor === null ? null : Money.fromMinor(command.budgetMaxMinor),
    );
    const temporaryAttachments = command.temporaryAttachments ?? [];
    const submission = OrderSubmission.create({
      id: submissionId,
      email,
      contactName: command.contactName,
      draft: {
        categoryId: command.categoryId,
        locationId: command.locationId,
        title: command.title,
        description: command.description,
        budget,
        temporaryAttachmentIds: temporaryAttachments.map((attachment) => attachment.attachmentId),
      },
      consentVersion: command.consentVersion,
      tokenHash: issuedToken.hash,
      createdAt: now,
      expiresAt,
    });
    await this.#transactions.execute(async () => {
      await this.#submissions.save(submission);
      await this.#guestAttachments.reserveForSubmission(submissionId, temporaryAttachments);
    });

    return { submissionId: submission.id, expiresAt };
  }
}
