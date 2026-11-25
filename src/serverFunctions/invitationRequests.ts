import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { InvitationRequestService } from "@/server/features/team/InvitationRequestService";
import {
  requireAuthenticatedContext,
  requireProjectContext,
} from "@/serverFunctions/middleware";

export const listInvitationRequests = createServerFn({ method: "GET" })
  .middleware(requireAuthenticatedContext)
  .handler(({ context }) => InvitationRequestService.list(context));

export const requestProjectInvitation = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    z.object({
      projectId: z.string().min(1),
      email: z.string().trim().email(),
    }),
  )
  .handler(({ data, context }) =>
    InvitationRequestService.request(context, context.projectId, data.email),
  );

export const reviewProjectInvitation = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(z.object({ id: z.string().uuid(), approve: z.boolean() }))
  .handler(({ data, context }) =>
    InvitationRequestService.review(context, data.id, data.approve),
  );
