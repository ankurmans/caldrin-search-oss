import type { AppError } from "@/server/lib/errors";

type Activity = {
  source: "app" | "agent" | "mcp";
  action: string;
  userId: string;
  organizationId: string | null;
  projectId?: string | null;
  outcome: "success" | "refused" | "failed";
  durationMs: number;
  errorCode?: AppError["code"];
};

/** Internal product events contain only identifiers and outcomes. */
export async function recordProductActivity(activity: Activity) {
  try {
    const [{ withPgClient }, { AuthRepository }] = await Promise.all([
      import("@/db"),
      import("@/server/auth/repositories/AuthRepository"),
    ]);
    const optedOut = await withPgClient(() =>
      AuthRepository.isAnalyticsOptedOut(activity.userId),
    );
    if (!optedOut) console.info("[product_activity]", activity);
  } catch {
    console.warn("[product_activity] could not check analytics preference");
  }
}
