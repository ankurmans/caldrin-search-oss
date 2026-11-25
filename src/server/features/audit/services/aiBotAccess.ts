import robotsParser from "robots-parser";
import { AI_BOTS } from "@/shared/ai-bots";

/**
 * Which AI crawlers a robots.txt lets fetch the site's home page. Pure: the
 * same text gives the same answer. A missing robots.txt allows everything,
 * which is what a crawler does too.
 */
export function evaluateAiBotAccess(origin: string, robotsText: string | null) {
  const robots =
    robotsText === null
      ? null
      : robotsParser(`${origin}/robots.txt`, robotsText);
  return AI_BOTS.map((bot) => ({
    ...bot,
    allowed: robots?.isAllowed(`${origin}/`, bot.token) ?? true,
  }));
}
