import { revealUtFor, type SeparationMatrix, type Vantage } from "./reveal";
import type { CommcastLogSnapshot, CommsMessage, RecipientId } from "./types";

/**
 * Commcast groups: a list of vantages sharing one thread, which every message
 * and every radio transmission is addressed to.
 *
 * Membership is a VALUE built from the `members` changes a vantage holds, and a
 * change is carried and delayed exactly like a message: it counts at a vantage
 * from the instant it reaches that vantage, one light-time from wherever it was
 * made. So a group opened or joined far away is not known here until word of
 * it has crossed, and an author addresses only the members it can see, which
 * is what starts a new member hearing a transmission already under way from
 * wherever it has got to, one light-time after the change reached its speaker.
 *
 * Changes only ever add. Nobody is removed and nothing is renamed, so the value
 * is the union of the changes that have landed and the order they land in
 * cannot matter.
 */

/** Every group known at `me` as of `utNow`, each with its members sorted. */
export function groupsAt(
  snapshot: CommcastLogSnapshot,
  me: Vantage,
  utNow: number | undefined,
  pairs?: SeparationMatrix,
): ReadonlyMap<string, readonly RecipientId[]> {
  const byGroup = new Map<string, Set<RecipientId>>();
  if (utNow === undefined) return new Map();
  const held = [
    ...snapshot.outbox.map((out) => out.msg),
    ...snapshot.inbox,
    ...snapshot.pending,
  ];
  for (const msg of held) {
    if (msg.kind !== "members" || !msg.members) continue;
    const at = revealUtFor(msg, me, pairs);
    if (at === null || utNow < at) continue;
    let members = byGroup.get(msg.groupId);
    if (!members) {
      members = new Set();
      byGroup.set(msg.groupId, members);
    }
    for (const member of msg.members) members.add(member);
  }
  return new Map(
    [...byGroup].map(([groupId, members]) => [groupId, [...members].sort()]),
  );
}

/**
 * The most recent group whose members are exactly `members`, so choosing the
 * same people again reopens their thread rather than starting a second one.
 */
export function groupWith(
  groups: ReadonlyMap<string, readonly RecipientId[]>,
  members: readonly RecipientId[],
): string | undefined {
  const wanted = [...new Set(members)].sort().join("\n");
  let found: string | undefined;
  for (const [groupId, held] of groups) {
    if (held.join("\n") === wanted) found = groupId;
  }
  return found;
}

/** A list of vantages as the operator reads it: their names, in alphabetical order. */
export function namesOf(
  ids: readonly RecipientId[],
  nameFor: (id: RecipientId) => string,
): string {
  return ids
    .map(nameFor)
    .sort((a, b) => a.localeCompare(b))
    .join(", ");
}

/** What a message says, in words: its body, or the membership change it makes. */
export function messageText(
  msg: CommsMessage,
  nameFor: (id: RecipientId) => string,
): string {
  if (msg.kind === "members") {
    const added = namesOf(msg.added ?? [], nameFor);
    return opensGroup(msg) ? `opened with ${added}` : `added ${added}`;
  }
  return msg.body ?? msg.kind;
}

/** The change that brought a group into being: everyone but its author came in with it. */
function opensGroup(msg: CommsMessage): boolean {
  const others = (msg.members ?? []).filter((m) => m !== msg.from);
  const added = new Set(msg.added ?? []);
  return others.length === added.size && others.every((m) => added.has(m));
}
