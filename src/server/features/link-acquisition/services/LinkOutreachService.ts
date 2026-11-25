import { OpportunityRepository } from "@/server/features/opportunities/repositories/OpportunityRepository";
import { OpportunityRefusal } from "@/server/features/opportunities/types";
import { LinkGapRepository } from "../repositories/LinkGapRepository";
import { LinkOutreachRepository } from "../repositories/LinkOutreachRepository";
import { LinkProspectRepository } from "../repositories/LinkProspectRepository";
import { buildDraft, hasPlaceholder } from "../rules/outreachDraft";
import type { LinkAcquisitionContext } from "./linkAcquisitionShared";

// Drafting is cheap, but a project should not be able to queue hundreds of
// outreach messages in a day.
const DRAFTS_PER_DAY = 50;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const actorOf = (ctx: LinkAcquisitionContext) => ctx.actor ?? "user";

/** Approving, marking sent and logging replies are statements by a person. */
function requirePerson(ctx: LinkAcquisitionContext, what: string) {
  if (actorOf(ctx) !== "user") {
    throw new OpportunityRefusal(
      `${what} needs a person. An agent can write and edit drafts, but only you can approve outreach or record that it was sent.`,
    );
  }
}

async function load(ctx: LinkAcquisitionContext, draftId: string) {
  const draft = await LinkOutreachRepository.getDraft(ctx.projectId, draftId);
  if (!draft) throw new OpportunityRefusal("That draft was not found.");
  const prospect = await LinkProspectRepository.getOne(
    ctx.projectId,
    draft.prospectId,
  );
  if (!prospect) throw new OpportunityRefusal("That prospect was not found.");
  return { draft, prospect };
}

function cleanEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase() || null;
  if (email && !EMAIL.test(email)) {
    throw new OpportunityRefusal("That is not an email address.");
  }
  return email;
}

/** Writes a draft from the prospect's recorded page and competitor links. */
async function generate(
  ctx: LinkAcquisitionContext,
  input: {
    prospectId: string;
    contactName?: string | null;
    contactEmail?: string | null;
  },
) {
  const prospect = await LinkProspectRepository.getOne(
    ctx.projectId,
    input.prospectId,
  );
  if (!prospect) throw new OpportunityRefusal("That prospect was not found.");
  if (!prospect.targetUrl) {
    throw new OpportunityRefusal(
      "Choose the page you want linked first. A draft needs something specific to point to.",
    );
  }
  const open = (
    await LinkOutreachRepository.listDrafts(ctx.projectId, prospect.id)
  ).find((draft) => ["draft", "approved", "exported"].includes(draft.status));
  if (open) {
    throw new OpportunityRefusal(
      `${prospect.referringDomain} already has an unsent draft. Edit it or withdraw it before writing another.`,
    );
  }
  const email = cleanEmail(input.contactEmail);
  const blocked = await LinkOutreachRepository.suppressed(ctx.projectId, [
    prospect.referringDomain,
    email ?? "",
  ]);
  if (blocked) {
    throw new OpportunityRefusal(
      `${blocked.value} is on the do-not-contact list (${blocked.reason.replace(/_/g, " ")}).`,
    );
  }
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  if (
    (await LinkOutreachRepository.draftsToday(
      ctx.projectId,
      startOfDay.toISOString(),
    )) >= DRAFTS_PER_DAY
  ) {
    throw new OpportunityRefusal(
      `This project already has ${DRAFTS_PER_DAY} drafts today. Review them before writing more.`,
    );
  }
  const [project, evidence] = await Promise.all([
    OpportunityRepository.getProjectBrand(ctx.projectId),
    LinkGapRepository.evidenceForDomains(ctx.projectId, [
      prospect.referringDomain,
    ]),
  ]);
  const used = evidence.filter((item) => !item.lostDate).slice(0, 3);
  const written = buildDraft({
    mode: prospect.campaignMode,
    brandName: project?.brandName ?? project?.name ?? "our team",
    referringDomain: prospect.referringDomain,
    pageUrl: prospect.pageUrl,
    evidence: used.map((item) => ({
      urlFrom: item.urlFrom,
      pageTitle: item.pageTitle,
      anchor: item.anchor,
      competitorDomain: item.competitorDomain,
      isSponsored: item.isSponsored,
    })),
    targetUrl: prospect.targetUrl,
    contactName: input.contactName?.trim() || null,
  });
  if (!written) {
    throw new OpportunityRefusal(
      "There is no real page on record for this site to refer to. Read its exact linking pages (Link Gap) or add the page URL, then try again.",
    );
  }
  const id = await LinkOutreachRepository.insertDraft({
    projectId: ctx.projectId,
    prospectId: prospect.id,
    subject: written.subject,
    body: written.body,
    contactName: input.contactName?.trim() || null,
    contactEmail: email,
    evidenceIds: used.map((item) => item.id),
    actor: actorOf(ctx),
  });
  return { draftId: id, usedEvidence: used.length };
}

/** A person's edit. Editing an approved draft takes the approval back. */
async function edit(
  ctx: LinkAcquisitionContext,
  input: {
    draftId: string;
    subject?: string;
    body?: string;
    contactName?: string | null;
    contactEmail?: string | null;
  },
) {
  const { draft } = await load(ctx, input.draftId);
  if (draft.status === "sent" || draft.status === "withdrawn") {
    throw new OpportunityRefusal(`A ${draft.status} draft cannot be edited.`);
  }
  const contactEmail =
    input.contactEmail === undefined
      ? draft.contactEmail
      : cleanEmail(input.contactEmail);
  const textChanged =
    (input.subject !== undefined && input.subject !== draft.subject) ||
    (input.body !== undefined && input.body !== draft.body);
  const wasApproved = draft.status !== "draft";
  await LinkOutreachRepository.updateDraft(
    ctx.projectId,
    draft.id,
    {
      subject: input.subject ?? draft.subject,
      body: input.body ?? draft.body,
      contactName:
        input.contactName === undefined ? draft.contactName : input.contactName,
      contactEmail,
      editedByUser:
        draft.editedByUser || (textChanged && actorOf(ctx) === "user"),
      ...(wasApproved
        ? { status: "draft" as const, approvedBy: null, approvedAt: null }
        : {}),
    },
    wasApproved
      ? {
          kind: "withdrawn",
          note: "Edited after approval, so the approval was taken back.",
          actor: actorOf(ctx),
          userId: ctx.userId,
        }
      : undefined,
  );
  return { approvalReset: wasApproved };
}

async function approve(ctx: LinkAcquisitionContext, draftId: string) {
  requirePerson(ctx, "Approving outreach");
  const { draft, prospect } = await load(ctx, draftId);
  if (draft.status !== "draft") {
    throw new OpportunityRefusal(`This draft is already ${draft.status}.`);
  }
  if (!draft.subject.trim() || !draft.body.trim()) {
    throw new OpportunityRefusal("The subject and body cannot be empty.");
  }
  if (hasPlaceholder(draft.subject) || hasPlaceholder(draft.body)) {
    throw new OpportunityRefusal("Fill in the [[placeholders]] first.");
  }
  const blocked = await LinkOutreachRepository.suppressed(ctx.projectId, [
    prospect.referringDomain,
    draft.contactEmail ?? "",
  ]);
  if (blocked) {
    throw new OpportunityRefusal(
      `${blocked.value} is on the do-not-contact list (${blocked.reason.replace(/_/g, " ")}).`,
    );
  }
  const duplicate = await LinkOutreachRepository.activeContactFor(
    ctx.projectId,
    prospect.referringDomain,
    draft.contactEmail,
    draft.id,
  );
  if (duplicate) {
    throw new OpportunityRefusal(
      `${duplicate.domain} already has a ${duplicate.status} draft${duplicate.contactEmail ? ` (to ${duplicate.contactEmail})` : ""}. Withdraw it first to avoid contacting the same site twice.`,
    );
  }
  await LinkOutreachRepository.updateDraft(
    ctx.projectId,
    draft.id,
    {
      status: "approved",
      approvedBy: ctx.userId,
      approvedAt: new Date().toISOString(),
    },
    { kind: "approved", actor: "user", userId: ctx.userId },
  );
  if (["discovered", "qualified", "ready"].includes(prospect.status)) {
    await LinkProspectRepository.applyPatch({
      projectId: ctx.projectId,
      rows: [prospect],
      patch: { status: "outreach_approved" },
      note: "Outreach draft approved",
      actor: "user",
      userId: ctx.userId,
    });
  }
}

/** Hands the approved text over. Nothing is sent from here. */
async function exportDraft(ctx: LinkAcquisitionContext, draftId: string) {
  const { draft } = await load(ctx, draftId);
  if (draft.status !== "approved" && draft.status !== "exported") {
    throw new OpportunityRefusal(
      "Only an approved draft can be exported. Approve it first.",
    );
  }
  if (draft.status === "approved") {
    await LinkOutreachRepository.updateDraft(
      ctx.projectId,
      draft.id,
      { status: "exported" },
      { kind: "exported", actor: actorOf(ctx), userId: ctx.userId },
    );
  }
  return {
    to: draft.contactEmail,
    subject: draft.subject,
    body: draft.body,
    note: "Caldrin does not send this message. Send it from your own mail client, then mark it as sent.",
  };
}

async function markSent(ctx: LinkAcquisitionContext, draftId: string) {
  requirePerson(ctx, "Recording that outreach was sent");
  const { draft, prospect } = await load(ctx, draftId);
  if (draft.status !== "approved" && draft.status !== "exported") {
    throw new OpportunityRefusal("Approve the draft before marking it sent.");
  }
  await LinkOutreachRepository.updateDraft(
    ctx.projectId,
    draft.id,
    { status: "sent" },
    { kind: "marked_sent", actor: "user", userId: ctx.userId },
  );
  await LinkProspectRepository.applyPatch({
    projectId: ctx.projectId,
    rows: [prospect],
    patch: { status: "contacted" },
    note: "Outreach sent from the person's own mail client",
    actor: "user",
    userId: ctx.userId,
  });
}

async function logReply(
  ctx: LinkAcquisitionContext,
  input: {
    draftId: string;
    outcome: "responded" | "declined" | "unsubscribed";
    note?: string | null;
  },
) {
  requirePerson(ctx, "Recording a reply");
  const { draft, prospect } = await load(ctx, input.draftId);
  if (draft.status !== "sent") {
    throw new OpportunityRefusal("Only a sent draft can have a reply.");
  }
  const logged = await LinkOutreachRepository.eventsOf([draft.id]);
  if (logged.some((event) => event.kind === "reply_logged")) {
    throw new OpportunityRefusal("A reply is already recorded for this draft.");
  }
  await LinkOutreachRepository.logEvent(draft.id, {
    kind: "reply_logged",
    note: `${input.outcome}${input.note ? `: ${input.note}` : ""}`,
    actor: "user",
    userId: ctx.userId,
  });
  if (input.outcome !== "responded") {
    await LinkOutreachRepository.addSuppression(
      ctx.projectId,
      prospect.referringDomain,
      input.outcome === "unsubscribed" ? "unsubscribed" : "declined",
    );
    if (input.outcome === "unsubscribed" && draft.contactEmail) {
      await LinkOutreachRepository.addSuppression(
        ctx.projectId,
        draft.contactEmail,
        "unsubscribed",
      );
    }
  }
  await LinkProspectRepository.applyPatch({
    projectId: ctx.projectId,
    rows: [prospect],
    patch: { status: input.outcome === "responded" ? "responded" : "rejected" },
    note:
      input.outcome === "responded"
        ? "Reply received"
        : `Site ${input.outcome}; added to the do-not-contact list`,
    actor: "user",
    userId: ctx.userId,
  });
}

async function withdraw(ctx: LinkAcquisitionContext, draftId: string) {
  const { draft } = await load(ctx, draftId);
  if (draft.status === "sent") {
    throw new OpportunityRefusal("A sent draft cannot be withdrawn.");
  }
  await LinkOutreachRepository.updateDraft(
    ctx.projectId,
    draft.id,
    { status: "withdrawn" },
    { kind: "withdrawn", actor: actorOf(ctx), userId: ctx.userId },
  );
}

async function list(projectId: string, prospectId?: string) {
  const drafts = await LinkOutreachRepository.listDrafts(projectId, prospectId);
  const [events, prospects] = await Promise.all([
    LinkOutreachRepository.eventsOf(drafts.map((draft) => draft.id)),
    LinkProspectRepository.getMany(projectId, [
      ...new Set(drafts.map((draft) => draft.prospectId)),
    ]),
  ]);
  return drafts.map((draft) => ({
    ...draft,
    referringDomain:
      prospects.find((prospect) => prospect.id === draft.prospectId)
        ?.referringDomain ?? null,
    events: events.filter((event) => event.draftId === draft.id),
  }));
}

async function addSuppression(ctx: LinkAcquisitionContext, value: string) {
  const clean = value.trim().toLowerCase();
  if (!clean) throw new OpportunityRefusal("Enter an email address or domain.");
  await LinkOutreachRepository.addSuppression(
    ctx.projectId,
    clean,
    "do_not_contact",
  );
}

export const LinkOutreachService = {
  generate,
  edit,
  approve,
  exportDraft,
  markSent,
  logReply,
  withdraw,
  list,
  addSuppression,
  listSuppressions: LinkOutreachRepository.listSuppressions,
  removeSuppression: LinkOutreachRepository.removeSuppression,
};
