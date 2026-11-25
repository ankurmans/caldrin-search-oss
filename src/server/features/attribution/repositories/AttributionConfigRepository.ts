import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  attributionBrands,
  attributionKeys,
  attributionProperties,
  attributionSettings,
  attributionSourceRules,
} from "@/db/schema";

const one = async <T>(rows: Promise<T[]>) => (await rows)[0] ?? null;

const getSettings = (projectId: string) =>
  one(
    db
      .select()
      .from(attributionSettings)
      .where(eq(attributionSettings.projectId, projectId))
      .limit(1),
  );

const saveSettings = (row: typeof attributionSettings.$inferInsert) =>
  db
    .insert(attributionSettings)
    .values(row)
    .onConflictDoUpdate({
      target: attributionSettings.projectId,
      set: {
        consentMode: row.consentMode,
        timezone: row.timezone,
        reportingCurrency: row.reportingCurrency,
        lookbackDays: row.lookbackDays,
        retentionDays: row.retentionDays,
        defaultModel: row.defaultModel,
        updatedAt: row.updatedAt,
      },
    });

const listProperties = (projectId: string) =>
  db
    .select()
    .from(attributionProperties)
    .where(eq(attributionProperties.projectId, projectId))
    .orderBy(asc(attributionProperties.createdAt));

const findPropertyByHost = (projectId: string, host: string) =>
  one(
    db
      .select()
      .from(attributionProperties)
      .where(
        and(
          eq(attributionProperties.projectId, projectId),
          eq(attributionProperties.host, host),
        ),
      )
      .limit(1),
  );

const insertProperty = (row: typeof attributionProperties.$inferInsert) =>
  db.insert(attributionProperties).values(row).onConflictDoNothing();

const markPropertyEvent = (id: string, at: string, verified: boolean) =>
  db
    .update(attributionProperties)
    .set({
      lastEventAt: at,
      ...(verified ? { verifiedAt: sql`coalesce(verified_at, ${at})` } : {}),
    })
    .where(eq(attributionProperties.id, id));

const deleteProperty = (projectId: string, id: string) =>
  db
    .delete(attributionProperties)
    .where(
      and(
        eq(attributionProperties.projectId, projectId),
        eq(attributionProperties.id, id),
      ),
    );

const listBrands = (projectId: string) =>
  db
    .select()
    .from(attributionBrands)
    .where(eq(attributionBrands.projectId, projectId))
    .orderBy(asc(attributionBrands.name));

const insertBrand = (row: typeof attributionBrands.$inferInsert) =>
  db.insert(attributionBrands).values(row).onConflictDoNothing();

const listSourceRules = (projectId: string) =>
  db
    .select()
    .from(attributionSourceRules)
    .where(
      and(
        eq(attributionSourceRules.projectId, projectId),
        eq(attributionSourceRules.enabled, true),
      ),
    )
    .orderBy(asc(attributionSourceRules.createdAt));

const insertSourceRule = (row: typeof attributionSourceRules.$inferInsert) =>
  db.insert(attributionSourceRules).values(row).onConflictDoNothing();

const deleteSourceRule = (projectId: string, id: string) =>
  db
    .delete(attributionSourceRules)
    .where(
      and(
        eq(attributionSourceRules.projectId, projectId),
        eq(attributionSourceRules.id, id),
      ),
    );

const listAllSettings = () =>
  db
    .select({
      projectId: attributionSettings.projectId,
      retentionDays: attributionSettings.retentionDays,
    })
    .from(attributionSettings);

const insertKey = (row: typeof attributionKeys.$inferInsert) =>
  db.insert(attributionKeys).values(row);

const findKey = (keyHash: string) =>
  one(
    db
      .select()
      .from(attributionKeys)
      .where(
        and(
          eq(attributionKeys.keyHash, keyHash),
          isNull(attributionKeys.revokedAt),
        ),
      )
      .limit(1),
  );

const getPublicKey = async (projectId: string) =>
  (
    await one(
      db
        .select({ value: attributionKeys.publicValue })
        .from(attributionKeys)
        .where(
          and(
            eq(attributionKeys.projectId, projectId),
            eq(attributionKeys.kind, "public"),
            isNull(attributionKeys.revokedAt),
          ),
        )
        .limit(1),
    )
  )?.value;

const revokeKeys = (projectId: string, kind: string, at: string) =>
  db
    .update(attributionKeys)
    .set({ revokedAt: at })
    .where(
      and(
        eq(attributionKeys.projectId, projectId),
        eq(attributionKeys.kind, kind),
        isNull(attributionKeys.revokedAt),
      ),
    );

const touchKey = (id: string, at: string) =>
  db
    .update(attributionKeys)
    .set({ lastUsedAt: at })
    .where(eq(attributionKeys.id, id));

const listKeys = (projectId: string) =>
  db
    .select({
      id: attributionKeys.id,
      kind: attributionKeys.kind,
      prefix: attributionKeys.prefix,
      createdAt: attributionKeys.createdAt,
      lastUsedAt: attributionKeys.lastUsedAt,
    })
    .from(attributionKeys)
    .where(
      and(
        eq(attributionKeys.projectId, projectId),
        isNull(attributionKeys.revokedAt),
      ),
    );

export const AttributionConfigRepository = {
  insertSourceRule,
  deleteSourceRule,
  listAllSettings,
  getSettings,
  saveSettings,
  listProperties,
  findPropertyByHost,
  insertProperty,
  markPropertyEvent,
  deleteProperty,
  listBrands,
  insertBrand,
  listSourceRules,
  insertKey,
  findKey,
  revokeKeys,
  getPublicKey,
  touchKey,
  listKeys,
};
