import { sort } from "remeda";
import {
  LINK_BASIS,
  SINGLE_VALUED,
  type IdentifierType,
} from "@/shared/attribution/vocabulary";
import { sha256Hex } from "@/server/lib/audit/ids";
import {
  AttributionIdentityRepository as repo,
  type NodeKey,
  type NodeRow,
} from "../repositories/AttributionIdentityRepository";

/** Which identity decides an event's subject when it carries several. */
const SUBJECT_PRIORITY: IdentifierType[] = [
  "user",
  "contact",
  "customer",
  "lead",
  "order",
  "deal",
  "account",
  "visitor",
];

const keyOf = (type: string, value: string) => `${type}\u0000${value}`;

function basisFor(a: string, b: string): string {
  const pair = sort([a, b], (x, y) => x.localeCompare(y)).join("_");
  return (
    Object.entries(LINK_BASIS).find(([key]) => key === pair)?.[1] ??
    LINK_BASIS.other
  );
}

/**
 * Whether two groups of identities can be one subject: a user, contact or
 * account that appears in both must be the same one. Two different users
 * sharing a browser stay two subjects.
 */
function mergeConflict(left: NodeRow[], right: NodeRow[]) {
  for (const type of SINGLE_VALUED) {
    const a = left.filter((n) => n.nodeType === type).map((n) => n.nodeValue);
    const b = right.filter((n) => n.nodeType === type).map((n) => n.nodeValue);
    if (a.length && b.length && a.some((v) => !b.includes(v)))
      return `Two different ${type} ids (${a[0]} and ${b[0]}) would be one subject`;
  }
  return null;
}

type Identity = { type: IdentifierType; value: string };

/** Joins two identities that arrived on one event, or records why it did not. */
async function joinPair(
  event: { projectId: string; eventId: string; at: string },
  a: Identity,
  b: Identity,
  subjectOf: Map<string, string>,
) {
  const { projectId, eventId, at } = event;
  const [x, y] =
    keyOf(a.type, a.value) <= keyOf(b.type, b.value) ? [a, b] : [b, a];
  const subjectA = subjectOf.get(keyOf(a.type, a.value))!;
  const subjectB = subjectOf.get(keyOf(b.type, b.value))!;
  let status = "active";
  let reason: string | null = basisFor(a.type, b.type);
  let merged: { from: string; to: string } | null = null;
  if (subjectA !== subjectB) {
    const nodes = await repo.nodesOfSubjects(projectId, [subjectA, subjectB]);
    const left = nodes.filter((n) => n.subjectId === subjectA);
    const right = nodes.filter((n) => n.subjectId === subjectB);
    const conflict = mergeConflict(left, right);
    if (conflict) {
      status = "conflict";
      reason = conflict;
    } else {
      const [keep, drop] =
        left.length >= right.length
          ? [subjectA, subjectB]
          : [subjectB, subjectA];
      await repo.reassignSubject(projectId, drop, keep);
      merged = { from: drop, to: keep };
      for (const [k, s] of subjectOf) if (s === drop) subjectOf.set(k, keep);
    }
  }
  await repo.insertLink({
    id: (
      await sha256Hex(`${projectId}|${x.type}|${x.value}|${y.type}|${y.value}`)
    ).slice(0, 36),
    projectId,
    aType: x.type,
    aValue: x.value,
    bType: y.type,
    bValue: y.value,
    status,
    evidenceEventId: eventId,
    reason,
    createdAt: at,
  });
  return { merged, conflict: status === "conflict" };
}

type IdentityResult = {
  /** The subject the event's outcome belongs to. */
  subjectId: string;
  /** Subjects that were folded into another; their conversions need re-crediting. */
  merged: { from: string; to: string }[];
  conflicts: number;
};

/**
 * Puts the identifiers an event carried into the identity graph and joins the
 * ones that arrived together. Only identifiers sent on the same source event
 * are joined, never an IP address, a device fingerprint or a guess. A join that
 * would put two different users in one subject is recorded as a conflict and
 * not made.
 */
export async function resolveIdentity(
  projectId: string,
  eventId: string,
  at: string,
  identifiers: { type: IdentifierType; value: string }[],
): Promise<IdentityResult> {
  const merged: IdentityResult["merged"] = [];
  let conflicts = 0;
  if (identifiers.length === 0)
    return { subjectId: `ev:${eventId}`, merged, conflicts };

  const keys: NodeKey[] = identifiers.map((i) => ({
    type: i.type,
    value: i.value,
  }));
  const existing = new Map(
    (await repo.findNodes(projectId, keys)).map((n) => [
      keyOf(n.nodeType, n.nodeValue),
      n,
    ]),
  );
  const created: NodeRow[] = [];
  for (const id of identifiers) {
    if (existing.has(keyOf(id.type, id.value))) continue;
    const node = {
      projectId,
      nodeType: id.type,
      nodeValue: id.value,
      subjectId: crypto.randomUUID(),
      firstSeenAt: at,
    };
    created.push(node);
    existing.set(keyOf(id.type, id.value), node);
  }
  if (created.length) await repo.insertNodes(created);

  // The subject each identifier is in now; updated as subjects merge.
  const subjectOf = new Map(
    identifiers.map((i) => [
      keyOf(i.type, i.value),
      existing.get(keyOf(i.type, i.value))!.subjectId,
    ]),
  );

  for (let i = 0; i < identifiers.length; i++) {
    for (const b of identifiers.slice(i + 1)) {
      const outcome = await joinPair(
        { projectId, eventId, at },
        identifiers[i],
        b,
        subjectOf,
      );
      if (outcome.merged) merged.push(outcome.merged);
      if (outcome.conflict) conflicts += 1;
    }
  }

  const lead =
    SUBJECT_PRIORITY.map((t) => identifiers.find((i) => i.type === t)).find(
      Boolean,
    ) ?? identifiers[0];
  return {
    subjectId: subjectOf.get(keyOf(lead.type, lead.value))!,
    merged,
    conflicts,
  };
}

/** All identities currently in the subjects. */
export async function nodesOfSubjects(projectId: string, subjectIds: string[]) {
  return repo.nodesOfSubjects(projectId, subjectIds);
}
