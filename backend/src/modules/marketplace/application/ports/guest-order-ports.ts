import type { Account } from "../../../identity/domain/account.ts";
import type { Email } from "../../../../shared/domain/value-objects.ts";
import type { OrderSubmission } from "../../domain/order-submission.ts";
import type { Order } from "../../domain/order.ts";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export type IssuedToken = Readonly<{
  raw: string;
  hash: string;
}>;

export interface VerificationTokenService {
  issue(subject: string): IssuedToken;
  hash(raw: string): string;
}

export interface OrderSubmissionRepository {
  save(submission: OrderSubmission): Promise<void>;
  findById(submissionId: string): Promise<OrderSubmission | null>;
  findByTokenHash(
    tokenHash: string,
    options?: Readonly<{ forUpdate?: boolean }>,
  ): Promise<OrderSubmission | null>;
}

export interface AccountRepository {
  save(account: Account): Promise<void>;
  findById(
    accountId: string,
    options?: Readonly<{ forUpdate?: boolean }>,
  ): Promise<Account | null>;
  findByEmail(email: Email): Promise<Account | null>;
}

export interface OrderRepository {
  save(order: Order): Promise<void>;
  findById(
    orderId: string,
    options?: Readonly<{ forUpdate?: boolean }>,
  ): Promise<Order | null>;
}

export interface SessionIssuer {
  issue(accountId: string): Promise<string>;
}

export interface TransactionManager {
  execute<T>(work: () => Promise<T>): Promise<T>;
}
