import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sendFeedback } from "@/server/features/feedback/services/FeedbackService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { FEEDBACK_KINDS, FEEDBACK_MAX_CHARS } from "@/shared/support";

const feedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  message: z.string().trim().min(5).max(FEEDBACK_MAX_CHARS),
});

export const submitFeedback = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(feedbackSchema)
  .handler(async ({ data, context }) => {
    await sendFeedback({
      userId: context.userId,
      userEmail: context.userEmail,
      ...data,
    });
    return { sent: true };
  });
