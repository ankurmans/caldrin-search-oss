import { AppError } from "@/server/lib/errors";
import { getPlatformAccess } from "@/server/features/billing/platformAccess";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaceBranding } from "@/db/schema";
import type { BrandingInput } from "@/types/schemas/branding";

export const DEFAULT_BRAND_NAME = "Caldrin Search";

export async function getBranding(organizationId: string) {
  const [row] = await db
    .select()
    .from(workspaceBranding)
    .where(eq(workspaceBranding.organizationId, organizationId))
    .limit(1);
  return row
    ? {
        brandName: row.brandName,
        logoUrl: row.logoUrl,
        accentColor: row.accentColor,
        hideAttribution: row.hideAttribution,
      }
    : null;
}

/** What a shared report shows: the workspace's branding, or ours. */
export async function getShareBrand(organizationId: string) {
  const saved = await getBranding(organizationId);
  const branding =
    saved && (await getPlatformAccess(organizationId)).canBrand ? saved : null;
  return {
    custom: branding !== null,
    name: branding?.brandName ?? DEFAULT_BRAND_NAME,
    logoUrl: branding?.logoUrl ?? null,
    accentColor: branding?.accentColor ?? null,
    hideAttribution: branding?.hideAttribution ?? false,
  };
}

export async function requireShareBranding(organizationId: string) {
  if (!(await getPlatformAccess(organizationId)).canBrand) {
    throw new AppError(
      "FORBIDDEN",
      "Shared report branding requires Agency. See Settings → Billing.",
    );
  }
}

export async function saveBranding(
  organizationId: string,
  input: BrandingInput,
) {
  const values = {
    brandName: input.brandName,
    logoUrl: input.logoUrl || null,
    accentColor: input.accentColor || null,
    hideAttribution: input.hideAttribution,
    updatedAt: new Date().toISOString(),
  };
  await db
    .insert(workspaceBranding)
    .values({ organizationId, ...values })
    .onConflictDoUpdate({
      target: workspaceBranding.organizationId,
      set: values,
    });
}

export async function clearBranding(organizationId: string) {
  await db
    .delete(workspaceBranding)
    .where(eq(workspaceBranding.organizationId, organizationId));
}
