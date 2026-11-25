import { env } from "cloudflare:workers";
import { AuthRepository } from "@/server/auth/repositories/AuthRepository";
import { getAllowedProjectIds } from "@/server/auth/project-access";
import { isSesConfigured, sendSesEmail } from "@/server/email/ses";
import { AppError } from "@/server/lib/errors";
import { MarketReportScheduleRepository as repo } from "../repositories/MarketReportScheduleRepository";
import { getReportMarkets, saveMarketComparison } from "./MarketReportService";

const DAY_MS = 86_400_000;

export async function getMarketReportDelivery(
  projectId: string,
  userId: string,
) {
  return {
    schedule: await repo.get(projectId, userId),
    configured: isSesConfigured(),
  };
}

export async function scheduleMarketReport(input: {
  projectId: string;
  userId: string;
  emailVerified: boolean;
  markets: { locationCode: number; languageCode: string }[];
  days: 7 | 28 | 90;
  cadence: 7 | 28;
}) {
  if (!input.emailVerified)
    throw new AppError(
      "VALIDATION_ERROR",
      "Verify your email before scheduling delivery.",
    );
  if (!isSesConfigured())
    throw new AppError(
      "VALIDATION_ERROR",
      "Scheduled email is unavailable on this deployment.",
    );
  const available = new Set(
    (await getReportMarkets(input.projectId)).map(({ key }) => key),
  );
  const chosen = new Set(
    input.markets.map(
      (market) => `${market.locationCode}:${market.languageCode}`,
    ),
  );
  if (
    chosen.size !== input.markets.length ||
    [...chosen].some((key) => !available.has(key))
  )
    throw new AppError(
      "VALIDATION_ERROR",
      "Choose distinct markets with saved runs in this project.",
    );

  await repo.save(
    {
      id: `${input.projectId}/${input.userId}`,
      projectId: input.projectId,
      userId: input.userId,
      cadence: input.cadence,
      days: input.days,
      nextRunAt: new Date(Date.now() + input.cadence * DAY_MS).toISOString(),
    },
    input.markets,
  );
}

export function stopMarketReportDelivery(projectId: string, userId: string) {
  return repo.clear(projectId, userId);
}

export async function deliverScheduledMarketReports(now = new Date()) {
  const configuredOrigin = env.BETTER_AUTH_URL;
  if (
    !isSesConfigured() ||
    !configuredOrigin ||
    !URL.canParse(configuredOrigin)
  )
    return;
  const origin = new URL(configuredOrigin).origin;
  if (!origin.startsWith("https://")) return;
  const due = await repo.due(now.toISOString());
  for (const { schedule, organizationId } of due) {
    const next = new Date(
      now.getTime() + schedule.cadence * DAY_MS,
    ).toISOString();
    if (!(await repo.claim(schedule.id, schedule.nextRunAt, next))) continue;
    try {
      const [membership, user] = await Promise.all([
        AuthRepository.getMembership(schedule.userId, organizationId),
        AuthRepository.getUser(schedule.userId),
      ]);
      if (!membership || !user?.emailVerified) {
        await repo.finish(
          schedule.id,
          next,
          "Skipped because email or workspace access changed",
        );
        continue;
      }
      const access = await getAllowedProjectIds(
        schedule.userId,
        organizationId,
        membership.role,
      );
      if (access && !access.includes(schedule.projectId)) {
        await repo.finish(
          schedule.id,
          next,
          "Skipped because project access changed",
        );
        continue;
      }
      const markets = await repo.listMarkets(schedule.id);
      const days =
        schedule.days === 7 || schedule.days === 90 ? schedule.days : 28;
      const report = await saveMarketComparison(
        { projectId: schedule.projectId, markets, days },
        { organizationId, userId: schedule.userId },
      );
      const link = `${origin}/p/${encodeURIComponent(schedule.projectId)}/reports/${encodeURIComponent(report.reportId)}`;
      if (
        (await repo.get(schedule.projectId, schedule.userId))?.nextRunAt !==
        next
      )
        continue;
      await sendSesEmail({
        to: user.email,
        subject: "Your Caldrin Search market report is ready",
        text: `Open your private market comparison report: ${link}`,
        html: `<p>Your market comparison is ready. <a href="${link}">Open report</a>.</p>`,
      });
      await repo.finish(schedule.id, next, "Sent", report.reportId);
    } catch {
      await repo.finish(schedule.id, next, "Delivery failed");
    }
  }
}
