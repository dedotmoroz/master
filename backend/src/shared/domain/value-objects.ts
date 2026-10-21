import { assertDomain } from "./domain-error.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SUPPORTED_CURRENCIES = new Set(["RUB"]);

export class Email {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  static create(value: string): Email {
    const normalized = value.trim().toLowerCase();
    assertDomain(
      normalized.length <= 254 && EMAIL_PATTERN.test(normalized),
      "INVALID_EMAIL",
      "Email address is invalid",
    );
    return new Email(normalized);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }
}

export class Money {
  readonly minor: number;
  readonly currency: string;

  private constructor(minor: number, currency: string) {
    this.minor = minor;
    this.currency = currency;
  }

  static fromMinor(minor: number, currency = "RUB"): Money {
    assertDomain(Number.isSafeInteger(minor), "INVALID_MONEY", "Money must use integer minor units");
    assertDomain(minor >= 0, "NEGATIVE_MONEY", "Money cannot be negative");
    assertDomain(SUPPORTED_CURRENCIES.has(currency), "UNSUPPORTED_CURRENCY", "Currency is not supported", {
      currency,
    });
    return new Money(minor, currency);
  }

  equals(other: Money): boolean {
    return this.minor === other.minor && this.currency === other.currency;
  }
}

export class MoneyRange {
  readonly min: Money | null;
  readonly max: Money | null;

  private constructor(min: Money | null, max: Money | null) {
    this.min = min;
    this.max = max;
  }

  static unspecified(): MoneyRange {
    return new MoneyRange(null, null);
  }

  static create(min: Money | null, max: Money | null): MoneyRange {
    if (min && max) {
      assertDomain(min.currency === max.currency, "MONEY_CURRENCY_MISMATCH", "Money range currencies differ");
      assertDomain(min.minor <= max.minor, "INVALID_MONEY_RANGE", "Minimum amount exceeds maximum amount");
    }
    return new MoneyRange(min, max);
  }
}

export function assertNonBlank(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  assertDomain(normalized.length > 0, "REQUIRED_FIELD", `${field} is required`, { field });
  assertDomain(normalized.length <= maxLength, "FIELD_TOO_LONG", `${field} is too long`, {
    field,
    maxLength,
  });
  return normalized;
}

export function assertEntityId(value: string, field: string): string {
  return assertNonBlank(value, field, 100);
}
