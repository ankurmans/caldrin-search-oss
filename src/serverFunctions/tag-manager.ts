import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { TagManagerService } from "@/server/features/attribution/tag-manager/TagManagerService";
import { containerPathSchema } from "@/server/features/attribution/tag-manager/TagManagerPort";
import {
  createGoogleAuthorizationUrl,
  GSC_INTEGRATION,
} from "@/server/features/google/googleOAuth";
import { LedgerRefusal } from "@/server/features/ledger/types";
import { AppError } from "@/server/lib/errors";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { requireProjectContext } from "@/serverFunctions/middleware";

const projectInput = z.object({ projectId: z.string().min(1) });
const entryInput = projectInput.extend({ entryId: z.string().min(1) });
const gtmPermission = { integration: ["manage" as const] };

const gtmContainerInput = z
  .string()
  .trim()
  .max(400)
  .transform((value) => {
    const prefix = "https://tagmanager.google.com/#/container/";
    return value.startsWith(prefix)
      ? value.slice(prefix.length).split("/workspaces/")[0]
      : value;
  })
  .pipe(containerPathSchema);

async function respond<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof LedgerRefusal)
      throw new AppError("CONFLICT", error.message);
    throw error;
  }
}

export const getTagManagerSetup = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput)
  .handler(async ({ context }) => ({
    ...(await TagManagerService.status(context)),
    canManage: hasOrgPermission(context.role, gtmPermission),
  }));

export const startTagManagerLink = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput.extend({ callbackURL: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    requireOrgPermission(context, gtmPermission);
    return {
      url: await createGoogleAuthorizationUrl({
        integration: GSC_INTEGRATION,
        tagManager: true,
        userId: context.userId,
        callbackURL: data.callbackURL,
        publicOrigin: getPublicOrigin(getRequest()),
      }),
    };
  });

export const disconnectTagManager = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput)
  .handler(({ context }) => {
    requireOrgPermission(context, gtmPermission);
    return TagManagerService.disconnect(context.userId);
  });

export const proposeTagManagerInstall = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectInput.extend({
      container: gtmContainerInput,
      hostname: z.string().min(1).max(253),
    }),
  )
  .handler(({ context, data }) => {
    requireOrgPermission(context, gtmPermission);
    return respond(() =>
      TagManagerService.propose(
        context,
        getPublicOrigin(getRequest()),
        data.container,
        data.hostname,
      ),
    );
  });

export const stageTagManagerInstall = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(entryInput)
  .handler(({ context, data }) => {
    requireOrgPermission(context, gtmPermission);
    return respond(() =>
      TagManagerService.stage(
        context,
        getPublicOrigin(getRequest()),
        data.entryId,
      ),
    );
  });

export const verifyTagManagerInstall = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(entryInput)
  .handler(({ context, data }) => {
    requireOrgPermission(context, gtmPermission);
    return respond(() =>
      TagManagerService.verify(
        context,
        getPublicOrigin(getRequest()),
        data.entryId,
      ),
    );
  });

export const rollbackTagManagerInstall = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(entryInput)
  .handler(({ context, data }) => {
    requireOrgPermission(context, gtmPermission);
    return respond(() => TagManagerService.rollback(context, data.entryId));
  });
