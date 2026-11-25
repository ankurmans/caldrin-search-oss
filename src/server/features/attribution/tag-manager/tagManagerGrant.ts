import {
  getGoogleAccessToken,
  revokeGoogleToken,
} from "@/server/features/google/googleOAuth";
import { GoogleAccountRepository } from "@/server/features/google/GoogleAccountRepository";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";
import { GTM_PROVIDER_ID } from "@/shared/tag-manager";
import { tagManagerPort } from "./TagManagerPort";

export async function tagManagerGrant(userId: string) {
  const [row] = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(
      and(eq(account.providerId, GTM_PROVIDER_ID), eq(account.userId, userId)),
    )
    .orderBy(desc(account.updatedAt))
    .limit(1);
  return row?.accountId ?? null;
}

export async function tagManagerPortForUser(userId: string, accountId: string) {
  return tagManagerPort(
    await getGoogleAccessToken({
      userId,
      accountId,
      providerId: GTM_PROVIDER_ID,
    }),
  );
}

export async function disconnectTagManagerGrant(userId: string) {
  const accountId = await tagManagerGrant(userId);
  if (!accountId) return { connected: false as const };
  const identity = { userId, accountId, providerId: GTM_PROVIDER_ID };
  const token = await getGoogleAccessToken(identity).catch(() => null);
  await db
    .delete(account)
    .where(
      and(
        eq(account.userId, userId),
        eq(account.accountId, accountId),
        eq(account.providerId, GTM_PROVIDER_ID),
      ),
    );
  if (
    token &&
    !(await GoogleAccountRepository.hasDataGrantsForGoogleAccount(accountId))
  ) {
    await revokeGoogleToken(token).catch(() => undefined);
  }
  return { connected: false as const };
}
