import { messageText } from "./groups";
import type { Vantage } from "./reveal";
import type { OutboundMessage, RecipientId } from "./types";
import type { CommcastEntry, CommcastFeed } from "./useCommcastFeed";

/**
 * One group's thread as it reads at this vantage: who is in it, and everything
 * of it that reached here.
 *
 * A thread per group rather than a filter over one log. A message names the
 * group it is for and only that group's members hold it, so what Kennedy said
 * to the craft and what Woomera said to Kennedy are two separate
 * correspondences that happen to share a screen.
 */
export interface CommcastThread {
  /** The group's id, which is the thread's identity however its membership grows. */
  key: string;
  /** The other members, this vantage excluded, sorted. */
  with: readonly RecipientId[];
  /** What has landed here, in landing order. Never reordered. */
  entries: readonly CommcastEntry[];
  /** This vantage's own words to the group, still on their round trip. */
  outbound: readonly OutboundMessage[];
  /**
   * The most recent thing that happened here, as the operator would read it.
   *
   * Derived in the walk rather than at the row, because "most recent" is the
   * same ordering question the list itself is sorted on and resolving it twice
   * is how the two disagree.
   */
  preview: string;
}

/**
 * Who an entry is a conversation WITH, from this vantage, where the group's
 * own membership is not known here: whoever sent it, plus everyone else it was
 * addressed to.
 *
 * `out` is what says this screen was the author, never a comparison of
 * `msg.from` against the local vantage: a screen holds its own outbox before
 * the first frame has told it where it is standing, and reading those as
 * somebody else's mail would file every one of them under its own address.
 */
export function counterpartiesOf(
  entry: CommcastEntry,
  me: Vantage,
): readonly RecipientId[] {
  if (entry.out) return entry.msg.to.filter((id) => id !== me.vantageId);
  return inboundCounterparties(entry.msg.from, entry.msg.to, me.vantageId);
}

/**
 * Who a thing ARRIVING here is a conversation with: whoever sent it, plus
 * everyone else it was addressed to, this vantage excluded.
 *
 * Split out of `counterpartiesOf` because the radio has the same question and
 * no `CommcastEntry` to ask it with.
 */
export function inboundCounterparties(
  from: RecipientId,
  to: readonly RecipientId[],
  mine: RecipientId | undefined,
): readonly RecipientId[] {
  return [...new Set([from, ...to])].filter((id) => id !== mine).sort();
}

/**
 * Every group thread this vantage holds, most recent activity first.
 *
 * Ranked by POSITION rather than by a UT, and the sequence it walks is the
 * feed's own: `log` is in the order things landed here and `outbound` is in
 * send order, so the last position a thread appears at is the last thing that
 * happened in it. A UT ordering would have to pick between the instant a
 * message was spoken and the instant it arrived, which differ by a light-time
 * and disagree about which of two threads is newer.
 *
 * Words still crossing rank ABOVE everything settled. Something is happening
 * in that conversation, which is what an operator scanning an inbox is looking
 * for.
 */
export function threadsOf(
  feed: CommcastFeed,
  me: Vantage,
  nameFor: (id: RecipientId) => string = (id) => id,
): readonly CommcastThread[] {
  interface Building {
    key: string;
    with: readonly RecipientId[];
    entries: CommcastEntry[];
    outbound: OutboundMessage[];
    preview: string;
    rank: number;
  }
  const byKey = new Map<string, Building>();
  const reach = (
    groupId: string,
    fallback: readonly RecipientId[],
  ): Building => {
    const held = byKey.get(groupId);
    if (held) return held;
    const fresh: Building = {
      key: groupId,
      with: membersBesideMe(feed.groups.get(groupId), me) ?? fallback,
      entries: [],
      outbound: [],
      preview: "",
      rank: 0,
    };
    byKey.set(groupId, fresh);
    return fresh;
  };
  let rank = 0;
  for (const entry of feed.log) {
    const thread = reach(entry.msg.groupId, counterpartiesOf(entry, me));
    thread.entries.push(entry);
    rank += 1;
    thread.rank = rank;
    thread.preview = messageText(entry.msg, nameFor);
  }
  for (const out of feed.outbound) {
    const thread = reach(
      out.msg.groupId,
      counterpartiesOf({ msg: out.msg, out }, me),
    );
    thread.outbound.push(out);
    rank += 1;
    thread.rank = rank;
    thread.preview = messageText(out.msg, nameFor);
  }
  return [...byKey.values()]
    .sort((a, b) => b.rank - a.rank)
    .map(({ rank: _rank, ...thread }) => thread);
}

/**
 * The thread for `groupId`, or an empty one.
 *
 * The empty case is a group the operator has just opened and not yet spoken
 * in, or one this vantage has only HEARD on the radio, which has to render as
 * itself rather than as the inbox. `fallback` names its other members when the
 * group's own membership has not reached here.
 */
export function threadFor(
  threads: readonly CommcastThread[],
  groupId: string,
  fallback: readonly RecipientId[],
  groups?: ReadonlyMap<string, readonly RecipientId[]>,
  me?: Vantage,
): CommcastThread {
  const held = threads.find((t) => t.key === groupId);
  if (held) return held;
  return {
    key: groupId,
    with:
      (me && membersBesideMe(groups?.get(groupId), me)) ?? [...fallback].sort(),
    entries: [],
    outbound: [],
    preview: "",
  };
}

function membersBesideMe(
  members: readonly RecipientId[] | undefined,
  me: Vantage,
): readonly RecipientId[] | undefined {
  return members?.filter((id) => id !== me.vantageId);
}
