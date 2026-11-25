import { ar, ht, pd, pr, rd, type WebPageEntry } from "./ownerTestWeb";

/** A labelled prompt: the page that should own it, or null when the site has none. */
export interface EvalCase {
  prompt: string;
  owner: string | null;
  /** The prompt asks which of several things to choose. */
  choose?: true;
}

export interface EvalSite {
  name: string;
  domain: string;
  web: Record<string, WebPageEntry>;
  /** What the sitemap lists. Pages that are only linked are left out. */
  listed: string[];
  cases: EvalCase[];
}

const dictation = "https://acme.example";
const boards = "https://boards.example";
const pipes = "https://rapidpipes.example";

/** Used while the scorer was written. */
export const DEV_SITES: EvalSite[] = [
  {
    name: "dictation software",
    domain: "acme.example",
    listed: [
      `${dictation}/dictate/best`,
      `${dictation}/dictate/best-dictation-apps`,
      `${dictation}/dictate/mac`,
      `${dictation}/dictate/mac-app`,
      `${dictation}/guides/dictate-mac`,
      `${dictation}/pricing`,
      `${dictation}/dictate/alternatives/rival`,
    ],
    web: {
      [`${dictation}/dictate/best`]: {
        to: `${dictation}/dictate/best-dictation-apps`,
      },
      [`${dictation}/dictate/best-dictation-apps`]: {
        spec: rd("Best Dictation Apps and Software (2026)", [
          "Alpha",
          "Beta",
          "Gamma",
          "Delta",
          "Epsilon",
        ]),
      },
      [`${dictation}/dictate/mac`]: {
        spec: rd("Best Dictation Apps for Mac (2026)", [
          "Alpha",
          "Beta",
          "Gamma",
          "Delta",
        ]),
      },
      [`${dictation}/dictate/mac-app`]: {
        spec: pd(
          "Best Dictation App for Mac",
          "Acme Dictate",
          "Acme Dictate turns speech into text on your Mac.",
        ),
      },
      [`${dictation}/guides/dictate-mac`]: {
        spec: ht("How to Dictate on a Mac", [
          "Turn dictation on",
          "Pick a shortcut",
          "Start speaking",
        ]),
      },
      [`${dictation}/pricing`]: {
        spec: pr("Pricing | Acme Dictate", ["Personal", "Team"]),
      },
      [`${dictation}/dictate/alternatives/rival`]: {
        spec: ar(
          "Rival alternatives",
          "People who try Rival often come to us afterwards.",
          "We keep this page short.",
        ),
      },
    },
    cases: [
      {
        prompt: "What is the best dictation software for Mac?",
        choose: true,
        owner: `${dictation}/dictate/mac`,
      },
      {
        prompt: "What is the best dictation software?",
        choose: true,
        owner: `${dictation}/dictate/best-dictation-apps`,
      },
      {
        prompt: "How do I dictate on a Mac?",
        owner: `${dictation}/guides/dictate-mac`,
      },
      {
        prompt: "How much does Acme Dictate cost, and is there a subscription?",
        owner: `${dictation}/pricing`,
      },
      { prompt: "Which CRM is best for plumbers?", choose: true, owner: null },
    ],
  },
  {
    name: "project boards",
    domain: "boards.example",
    listed: [
      `${boards}/compare/best-kanban-tools`,
      `${boards}/pricing`,
      `${boards}/features/boards`,
      `${boards}/guides/import-spreadsheet`,
      `${boards}/blog/why-we-built-boards`,
    ],
    web: {
      [`${boards}/compare/best-kanban-tools`]: {
        spec: rd("Best Kanban Board Tools for Small Teams", [
          "Boards",
          "Columns",
          "Cardly",
          "Trellis",
        ]),
        failTimes: 1,
      },
      [`${boards}/pricing`]: {
        spec: pr("Boards pricing and plans", ["Free", "Team", "Business"]),
      },
      [`${boards}/features/boards`]: {
        spec: pd(
          "Kanban boards for teams",
          "Boards",
          "Boards lets small teams plan work on a kanban board.",
        ),
      },
      [`${boards}/guides/import-spreadsheet`]: {
        spec: ht("How to import a spreadsheet into Boards", [
          "Export your sheet as CSV",
          "Open the import tool",
          "Map the columns",
        ]),
      },
      [`${boards}/blog/why-we-built-boards`]: {
        spec: ar(
          "Why we built Boards",
          "We were tired of tools that did too much.",
          "Boards does a few things well.",
        ),
      },
    },
    cases: [
      {
        prompt: "What are the best kanban board tools for small teams?",
        choose: true,
        owner: `${boards}/compare/best-kanban-tools`,
      },
      {
        prompt: "How do I import a spreadsheet into Boards?",
        owner: `${boards}/guides/import-spreadsheet`,
      },
      {
        prompt: "How much does Boards cost per user?",
        owner: `${boards}/pricing`,
      },
      {
        prompt: "Does Boards have a free plan?",
        owner: `${boards}/pricing`,
      },
      {
        prompt: "Which payroll software handles contractors?",
        choose: true,
        owner: null,
      },
    ],
  },
  {
    name: "local plumber",
    domain: "rapidpipes.example",
    listed: [
      `${pipes}/services/emergency-plumber`,
      `${pipes}/rates`,
      `${pipes}/blog/unclog-a-drain`,
      `${pipes}/services/water-heaters`,
      `${pipes}/blog/water-heater-buying-guide`,
    ],
    web: {
      [`${pipes}/services/emergency-plumber`]: {
        spec: ar(
          "Emergency plumber in Denver",
          "We offer same day emergency plumbing across Denver, day or night.",
          "Call us and a plumber will be on the way within the hour.",
        ),
      },
      [`${pipes}/rates`]: {
        spec: pr("Plumbing rates and pricing in Denver", [
          "Call-out",
          "Hourly",
          "Emergency",
        ]),
      },
      [`${pipes}/blog/unclog-a-drain`]: {
        spec: ht("How to unclog a drain", [
          "Remove the stopper",
          "Use a plunger",
          "Try a drain snake",
        ]),
        links: [`${pipes}/blog/leaky-faucet-fix`],
      },
      [`${pipes}/services/water-heaters`]: {
        spec: pd(
          "Water heater installation",
          "Rapid Pipes",
          "We install and repair water heaters.",
        ),
      },
      [`${pipes}/blog/water-heater-buying-guide`]: {
        spec: rd("The best water heater brands in 2026", [
          "Rheem",
          "Bradford",
          "Noritz",
          "Rinnai",
        ]),
      },
      [`${pipes}/blog/leaky-faucet-fix`]: {
        spec: ht("How to fix a leaky faucet", [
          "Turn off the water",
          "Replace the washer",
          "Reassemble the faucet",
        ]),
      },
    },
    cases: [
      {
        prompt: "How much does a plumber cost in Denver?",
        owner: `${pipes}/rates`,
      },
      {
        prompt: "How do I fix a leaky faucet?",
        owner: `${pipes}/blog/leaky-faucet-fix`,
      },
      {
        prompt: "How do I unclog a drain?",
        owner: `${pipes}/blog/unclog-a-drain`,
      },
      {
        prompt: "What are the best water heater brands?",
        choose: true,
        owner: `${pipes}/blog/water-heater-buying-guide`,
      },
      {
        prompt: "Do you offer same day emergency plumbing in Denver?",
        owner: `${pipes}/services/emergency-plumber`,
      },
    ],
  },
];
