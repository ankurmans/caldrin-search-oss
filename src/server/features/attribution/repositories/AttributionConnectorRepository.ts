import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { attributionConnectors, projects } from "@/db/schema";

const one = async <T>(rows: Promise<T[]>) => (await rows)[0] ?? null;

const insert = (row: typeof attributionConnectors.$inferInsert) =>
  db.insert(attributionConnectors).values(row);

const list = (projectId: string) =>
  db
    .select()
    .from(attributionConnectors)
    .where(eq(attributionConnectors.projectId, projectId));

const get = (id: string) =>
  one(
    db
      .select()
      .from(attributionConnectors)
      .where(eq(attributionConnectors.id, id))
      .limit(1),
  );

const remove = (projectId: string, id: string) =>
  db
    .delete(attributionConnectors)
    .where(
      and(
        eq(attributionConnectors.projectId, projectId),
        eq(attributionConnectors.id, id),
      ),
    );

const recordEvent = (id: string, at: string) =>
  db
    .update(attributionConnectors)
    .set({ lastEventAt: at })
    .where(eq(attributionConnectors.id, id));

const recordFailure = (id: string, at: string, reason: string) =>
  db
    .update(attributionConnectors)
    .set({
      failedCount: sql`${attributionConnectors.failedCount} + 1`,
      lastFailureAt: at,
      lastFailure: reason.slice(0, 200),
    })
    .where(eq(attributionConnectors.id, id));

/** The newest connector of a kind in another project of the same workspace. */
const findWorkspaceConnector = async (projectId: string, kind: string) => {
  const self = await one(
    db
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1),
  );
  if (!self) return null;
  return one(
    db
      .select({
        sealedSecret: attributionConnectors.sealedSecret,
        projectName: projects.name,
      })
      .from(attributionConnectors)
      .innerJoin(projects, eq(projects.id, attributionConnectors.projectId))
      .where(
        and(
          eq(projects.organizationId, self.organizationId),
          eq(attributionConnectors.kind, kind),
          ne(attributionConnectors.projectId, projectId),
        ),
      )
      .orderBy(desc(attributionConnectors.createdAt))
      .limit(1),
  );
};

export const AttributionConnectorRepository = {
  findWorkspaceConnector,
  insert,
  list,
  get,
  remove,
  recordEvent,
  recordFailure,
};
