export type AuthenticatedAccount = Readonly<{
  accountId: string;
  capabilities: readonly ("customer" | "contractor" | "admin")[];
}>;

export interface SessionAuthenticator {
  authenticate(rawToken: string): Promise<AuthenticatedAccount | null>;
}
