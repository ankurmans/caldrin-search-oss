// A Google sign-in that lands on an account nobody ever confirmed by email
// (email and password sign-up, link never opened) proves the mailbox, and
// Better Auth then links Google to it. Whoever registered that account could
// have been someone else, so the password and any standing sessions are
// dropped first: only the person who owns the mailbox keeps access. Search
// Console and Analytics grants stay, they hold the account's own data.
export async function dropUnprovenCredentials(
  ctx: {
    context: {
      internalAdapter: {
        findUserById(id: string): Promise<{ emailVerified: boolean } | null>;
        findAccounts(
          userId: string,
        ): Promise<{ id: string; providerId: string }[]>;
        deleteAccount(id: string): Promise<unknown>;
        deleteUserSessions(userId: string): Promise<unknown>;
      };
    };
  },
  userId: string,
): Promise<void> {
  const { internalAdapter } = ctx.context;
  const user = await internalAdapter.findUserById(userId);
  if (!user || user.emailVerified) return;
  for (const account of await internalAdapter.findAccounts(userId)) {
    if (account.providerId === "credential")
      await internalAdapter.deleteAccount(account.id);
  }
  await internalAdapter.deleteUserSessions(userId);
}
