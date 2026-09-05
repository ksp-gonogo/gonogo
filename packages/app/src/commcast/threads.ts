import type { Vantage } from "./reveal";
import type { OutboundMessage, RecipientId } from "./types";
import type { CommcastEntry, CommcastFeed } from "./useCommcastFeed";

/**
 * One conversation as it reads at this vantage: who it is with, and everything
 * of it that reached here.
 *
 * A conversation rather than a filter over one log, and the distinction is the
 * whole reason the recipient dropdown had to go. A picker above a single
 * transcript said the log was one thread shown through a lens, which was never
 * what the addressed model made true: a message names who it is for and only
 * those ends hold it, so what Kennedy said to the craft and what Woomera said
 * to Kennedy are two separate correspondences that happen to share a screen.
 */
export interface CommcastThread {
  /** Sorted, so one pair of ends is one thread whichever way a message went. */
  key: string;
  /** The other ends, this vantage excluded. Sorted the same as `key`. */
  with: readonly RecipientId[];
  /** What has landed here, in landing order. Never reordered. */
  entries: readonly CommcastEntry[];
  /** This vantage's own words to these ends, still on their round trip. */
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

/** The ends of a conversation, as a stable identity. */
export function threadKeyOf(ids: readonly RecipientId[]): string {
  return JSON.stringify([...ids].sort());
}

/**
 * Who an entry is a conversation WITH, from this vantage.
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
  if (entry.out) return entry.msg.to;
  return inboundCounterparties(entry.msg.from, entry.msg.to, me.vantageId);
}

/**
 * Who a thing ARRIVING here is a conversation with: whoever sent it, plus
 * everyone else it was addressed to.
 *
 * Split out of `counterpartiesOf` because the radio has the same question and
 * no `CommcastEntry` to ask it with. A live transmission has to land in the
 * conversation its speaker's TEXT lands in, or the indicator light would name a
 * thread the inbox does not hold, and the mute the operator set on that
 * conversation would not reach the voice coming in on it.
 */
export function inboundCounterparties(
  from: RecipientId,
  to: readonly RecipientId[],
  mine: RecipientId | undefined,
): readonly RecipientId[] {
  return [from, ...to.filter((id) => id !== mine)];
}

/**
 * Every conversation this vantage holds, most recent activity first.
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
  const reach = (ids: readonly RecipientId[]): Building => {
    const key = threadKeyOf(ids);
    const held = byKey.get(key);
    if (held) return held;
    const fresh: Building = {
      key,
      with: [...ids].sort(),
      entries: [],
      outbound: [],
      preview: "",
      rank: 0,
    };
    byKey.set(key, fresh);
    return fresh;
  };
  let rank = 0;
  for (const entry of feed.log) {
    const thread = reach(counterpartiesOf(entry, me));
    thread.entries.push(entry);
    rank += 1;
    thread.rank = rank;
    thread.preview = previewOf(entry.msg.body, entry.msg.kind);
  }
  for (const out of feed.outbound) {
    const thread = reach(out.msg.to);
    thread.outbound.push(out);
    rank += 1;
    thread.rank = rank;
    thread.preview = previewOf(out.msg.body, out.msg.kind);
  }
  return [...byKey.values()].sort((a, b) => b.rank - a.rank);
}

/**
 * The thread with `ids`, or an empty one.
 *
 * The empty case is a conversation the operator has just started and not yet
 * spoken in, which has to render as itself rather than as the inbox: they
 * chose a recipient and are looking at the box they will type into.
 */
export function threadFor(
  threads: readonly CommcastThread[],
  ids: readonly RecipientId[],
): CommcastThread {
  const key = threadKeyOf(ids);
  return (
    threads.find((t) => t.key === key) ?? {
      key,
      with: [...ids].sort(),
      entries: [],
      outbound: [],
      preview: "",
    }
  );
}

/** A message's own words, or the mode of one that has none to show. */
function previewOf(body: string | undefined, kind: string): string {
  return body ?? kind;
}
