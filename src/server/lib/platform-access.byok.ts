import { AppError } from "@/server/lib/errors";

export async function getPlatformAccess(_organizationId: string) {
  return {
    plan: null as string | null,
    hasPaidSubscription: false,
    renewsAt: null as string | null,
    operatorGranted: false,
    canInvite: true,
    canInviteGuests: false,
    canBrand: false,
    brandingGraceEndsAt: null as string | null,
  };
}

export async function requirePlatformSeat(
  _organizationId: string,
  role: string,
  _excludingUserId?: string,
) {
  if (role === "scoped")
    throw new AppError(
      "FORBIDDEN",
      "Client guests are unavailable in this installation.",
    );
}
