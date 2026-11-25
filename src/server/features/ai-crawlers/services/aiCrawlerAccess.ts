import { AiCrawlerRepository as repo } from "../repositories/AiCrawlerRepository";
import { evaluateAiBotAccess } from "@/server/features/audit/services/aiBotAccess";
import { fetchRobotsTxtText } from "@/server/lib/audit/discovery";
import { AppError } from "@/server/lib/errors";
import { getCrawlerActivity } from "./aiCrawlerActivity";

const RECENT_DAYS = 28;

/**
 * Which known AI crawlers the site's live robots.txt lets in, with each bot's
 * recent visits when visit data is connected. A bot that is blocked
 * but still visiting is listed, since a user agent can be claimed by anyone.
 */
export async function checkCrawlerAccess(projectId: string) {
  const domain = await repo.getProjectDomain(projectId);
  if (!domain) throw new AppError("NOT_FOUND");
  const origin = `https://${domain}`;
  const [robotsText, activity] = await Promise.all([
    fetchRobotsTxtText(origin, null, async () => false),
    getCrawlerActivity({ projectId, days: RECENT_DAYS }),
  ]);
  const visits = new Map(activity.bots.map((bot) => [bot.token, bot.hits]));
  return {
    origin,
    robotsFound: robotsText !== null,
    hasVisitData: activity.source !== null,
    bots: evaluateAiBotAccess(origin, robotsText).map((bot) => ({
      ...bot,
      recentHits: activity.source ? (visits.get(bot.token) ?? 0) : null,
    })),
  };
}
