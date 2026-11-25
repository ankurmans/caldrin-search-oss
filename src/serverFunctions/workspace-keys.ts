import { createServerFn } from "@tanstack/react-start";
import { AuditLogService } from "@/server/features/audit-log/services/AuditLogService";
import { z } from "zod";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import {
  deleteCredential,
  getCredential,
  listCredentialStatus,
  saveCredential,
  setWorkspaceMode,
} from "@/server/features/workspace/credentials";
import {
  checkKey,
  dataforseoBasicToken,
} from "@/server/features/workspace/key-check";
import { AppError } from "@/server/lib/errors";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { isLlmProvider } from "@/shared/llm-providers";

// Keys are owner/admin territory (the same gate as the Google connections).
// Scoped and ordinary members never see that a key exists.
export const getWorkspaceKeys = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    if (!hasOrgPermission(context.role, { workspace: ["manage"] })) {
      return { canManage: false as const };
    }
    return {
      canManage: true as const,
      ...(await listCredentialStatus(context.organizationId)),
    };
  });

const saveSchema = z
  .object({
    kind: z.enum([
      "dataforseo",
      "tinyfish",
      "llm",
      "anthropic",
      "perplexity",
      "openai",
      "gemini",
    ]),
    provider: z.string().trim().min(1).max(40),
    // For DataForSEO this is the API password, and login is required.
    apiKey: z.string().trim().min(8).max(500),
    login: z.string().trim().max(200).optional(),
    accountId: z.string().trim().max(100).optional(),
    modelFast: z.string().trim().max(120).optional(),
    modelSmart: z.string().trim().max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "llm" && !isLlmProvider(value.provider)) {
      ctx.addIssue({ code: "custom", message: "Unknown AI provider" });
    }
    if (value.kind === "dataforseo" && !value.login) {
      ctx.addIssue({
        code: "custom",
        path: ["login"],
        message: "DataForSEO needs your API login",
      });
    }
    if (value.kind === "llm" && value.provider === "cloudflare") {
      if (!value.accountId) {
        ctx.addIssue({
          code: "custom",
          path: ["accountId"],
          message: "Cloudflare needs your account id",
        });
      }
    }
  });

// The key is tried before it is stored, so a bad one never replaces a good one.
export const saveWorkspaceKey = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(saveSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    const credential = {
      kind: data.kind,
      provider: data.kind === "llm" ? data.provider : data.kind,
      apiKey:
        data.kind === "dataforseo" && data.login
          ? dataforseoBasicToken(data.login, data.apiKey)
          : data.apiKey,
      accountId: data.accountId || null,
      modelFast: data.kind === "llm" ? data.modelFast || null : null,
      modelSmart: data.kind === "llm" ? data.modelSmart || null : null,
    };
    const result = await checkKey(credential);
    if (!result.ok) return result;
    await saveCredential(context.organizationId, credential);
    await AuditLogService.recordUser(
      context,
      "workspace.key_saved",
      `Saved the ${credential.provider} key`,
      { targetKind: "credential", targetId: credential.kind },
    );
    return { ok: true as const };
  });

const kindSchema = z.object({
  kind: z.enum([
    "dataforseo",
    "tinyfish",
    "llm",
    "anthropic",
    "perplexity",
    "openai",
    "gemini",
  ]),
});

// Re-tries the stored key, for when a provider starts refusing it later.
export const testWorkspaceKey = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(kindSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    const credential = await getCredential(context.organizationId, data.kind);
    if (!credential) {
      return { ok: false as const, message: "No key saved yet." };
    }
    return checkKey(credential);
  });

export const removeWorkspaceKey = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(kindSchema)
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { workspace: ["manage"] });
    await deleteCredential(context.organizationId, data.kind);
    await AuditLogService.recordUser(
      context,
      "workspace.key_removed",
      `Removed the ${data.kind} key`,
      { targetKind: "credential", targetId: data.kind },
    );
    return { ok: true as const };
  });

// Moving to your own keys is one way. Going back to the deployment's keys
// spends the operator's money, so no request can do it; the operator sets it.
export const useOwnWorkspaceKeys = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(async ({ context }) => {
    if (context.role !== "owner") {
      throw new AppError(
        "FORBIDDEN",
        "Only the workspace owner can change this.",
      );
    }
    await setWorkspaceMode(context.organizationId, "byok");
    await AuditLogService.recordUser(
      context,
      "workspace.mode_changed",
      "Switched the workspace to its own provider keys",
    );
    return { ok: true as const };
  });
