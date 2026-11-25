import { z } from "zod";
import { AppError } from "@/server/lib/errors";

const API = "https://tagmanager.googleapis.com/tagmanager/v2/";
export const containerPathSchema = z
  .string()
  .regex(/^accounts\/[0-9]+\/containers\/[0-9]+$/);
const workspacePathSchema = z
  .string()
  .regex(/^accounts\/[0-9]+\/containers\/[0-9]+\/workspaces\/[0-9]+$/);
const numericId = z.string().regex(/^[0-9]+$/);

const containerSchema = z.object({
  path: containerPathSchema,
  name: z.string(),
  publicId: z.string(),
  domainName: z.array(z.string()).optional(),
  usageContext: z.array(z.string()).optional(),
});
const workspaceSchema = z.object({ path: workspacePathSchema });
const triggerSchema = z.object({
  triggerId: numericId,
  name: z.string(),
  type: z.string(),
});
const tagSchema = z.object({
  tagId: numericId,
  type: z.string(),
  name: z.string(),
  firingTriggerId: z.array(z.string()).optional(),
  parameter: z
    .array(
      z.object({ key: z.string().optional(), value: z.string().optional() }),
    )
    .optional(),
});
const versionSchema = z.object({
  containerVersionId: numericId,
  tag: z.array(tagSchema).optional(),
});

export function tagManagerPort(token: string) {
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init?: RequestInit,
  ): Promise<T | null> {
    const response = await fetch(API + path, {
      ...init,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) {
      throw new AppError(
        "FORBIDDEN",
        "Tag Manager refused this request. Check your container permissions and authorization.",
      );
    }
    if (!response.ok)
      throw new AppError(
        "UPSTREAM_UNAVAILABLE",
        "Tag Manager returned HTTP " + response.status + ".",
      );
    if (init?.method === "DELETE" || response.status === 204) return null;
    return schema.parse(await response.json());
  }

  function post<T>(path: string, schema: z.ZodType<T>, payload: object) {
    return request(path, schema, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  return {
    container: (path: string) =>
      request(containerPathSchema.parse(path), containerSchema),
    live: (path: string) =>
      request(
        containerPathSchema.parse(path) + "/versions:live",
        versionSchema,
      ),
    createWorkspace: (path: string, name: string) =>
      post(containerPathSchema.parse(path) + "/workspaces", workspaceSchema, {
        name,
      }),
    createPageTrigger: (workspace: string, name: string) =>
      post(workspacePathSchema.parse(workspace) + "/triggers", triggerSchema, {
        name,
        type: "pageview",
      }),
    createTag: (
      workspace: string,
      name: string,
      triggerId: string,
      html: string,
    ) =>
      post(workspacePathSchema.parse(workspace) + "/tags", tagSchema, {
        name,
        type: "html",
        firingTriggerId: [numericId.parse(triggerId)],
        parameter: [{ key: "html", type: "template", value: html }],
      }),
    tag: (workspace: string, tagId: string) =>
      request(
        workspacePathSchema.parse(workspace) +
          "/tags/" +
          numericId.parse(tagId),
        tagSchema,
      ),
    deleteTag: (workspace: string, tagId: string) =>
      request(
        workspacePathSchema.parse(workspace) +
          "/tags/" +
          numericId.parse(tagId),
        z.unknown(),
        { method: "DELETE" },
      ),
  };
}

export type TagManagerPort = ReturnType<typeof tagManagerPort>;
