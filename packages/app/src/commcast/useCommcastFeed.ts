import { DelayedPlayoutBuffer } from "@ksp-gonogo/sitrep-sdk/media";
import { useViewClockOptional } from "@ksp-gonogo/sitrep-sdk/spine";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommcastThread } from "./CommcastContext";
import {
  byArrivalAt,
  deliveryFor,
  revealUtFor,
  type SeparationMatrix,
  type Vantage,
} from "./reveal";
import type { CommsMessage } from "./types";

/**
 * What one seat can currently see of the thread.
 *
 * The three lists are three genuinely different states and are kept apart
 * rather than merged behind a flag: `revealed` has arrived, `inTransit` is
 * still crossing and has an instant it will land at, and `unsent` never will
 * because the author had no path when they spoke.
 */
export interface CommcastFeed {
  /** Arrived here, in the order it arrived HERE. Never reordered. */
  revealed: readonly CommsMessage[];
  /** Spoken, still crossing, soonest first. */
  inTransit: readonly CommsMessage[];
  /** Spoken with no path home: never delivered, and the author is told. */
  unsent: readonly CommsMessage[];
}

const EMPTY_FEED: CommcastFeed = { revealed: [], inTransit: [], unsent: [] };

/**
 * Runs the per-recipient reveal for one seat.
 *
 * The release is a clock comparison and never a `setTimeout`, so a warp, a
 * quickload or a revert moves the clock and every pending message moves with
 * it. That is the valuable half of `DelayedPlayoutBuffer`'s design and the
 * reason to use the shipped buffer rather than a bespoke timer.
 *
 * What the buffer is fed is NOT the shared clock, though: it gets an adapter
 * whose `confirmedEdgeUt()` returns `utNowEstimate()`. A video frame carries a
 * capture UT from the craft's past and is rightly released against the delayed
 * confirmed edge; a human message carries a send UT minted at the sender's
 * present, and releasing it against the confirmed edge would hold it for
 * `sentUt + 2 x delay`, a round trip for a one-way utterance.
 *
 * Release ORDER is why the buffer earns its place over a sort. Sorting the
 * whole thread by reveal instant retroactively inserts: a straggler that
 * reaches this screen now, carrying a reveal instant in the past, would land
 * above messages the operator has already read. The buffer appends in RELEASE
 * order, so a backlog replays in its own historical order and a straggler
 * lands at the end, where it honestly arrived.
 */
export function useCommcastFeed(
  thread: CommcastThread | null,
  me: Vantage,
  pairs?: SeparationMatrix,
): CommcastFeed {
  const clock = useViewClockOptional();
  const [snapshot, setSnapshot] = useState(
    () => thread?.snapshot().messages ?? [],
  );
  const [revealed, setRevealed] = useState<readonly CommsMessage[]>([]);

  useEffect(() => {
    if (!thread) {
      setSnapshot([]);
      return;
    }
    setSnapshot(thread.snapshot().messages);
    return thread.subscribe((snap) => setSnapshot(snap.messages));
  }, [thread]);

  // The buffer is rebuilt whenever this seat's own vantage changes, because
  // every reveal instant in it was computed against that vantage. Its first
  // arrival (from `undefined` to a real centre) is the common case.
  const seatKey = `${me.seat}|${me.vantageId ?? ""}`;
  /**
   * Each message's reveal instant, pinned the first time it is resolved.
   *
   * The RECEIVER's half of the freeze. A sender cannot freeze a separation for
   * a broadcast, so each reader resolves its own, and having resolved it must
   * not re-read: a separation that grows afterwards would move the instant
   * later and un-deliver something already on screen.
   */
  const pinned = useRef<Map<string, number>>(new Map());
  const [buffer, setBuffer] =
    useState<DelayedPlayoutBuffer<CommsMessage> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `seatKey` is the identity of the reader's vantage, which every pinned reveal instant was computed against. The body reads it only through those instants, so this dep is the only thing that can rebuild the buffer when the seat's vantage changes.
  useEffect(() => {
    if (!clock) {
      setBuffer(null);
      return;
    }
    pinned.current = new Map();
    setRevealed([]);
    const next = new DelayedPlayoutBuffer<CommsMessage>({
      view: {
        confirmedEdgeUt: () => clock.utNowEstimate(),
        onFrame: (cb) => clock.onFrame(cb),
      },
      onRelease: (frame) => {
        const msg = frame.data;
        if (!msg) return;
        setRevealed((prev) => [...prev, msg]);
      },
      // A message is never evicted for size: dropping somebody's words to save
      // bytes would be the one failure this feature cannot afford, and a typed
      // thread does not approach any cap worth having.
      maxBufferedBytes: Number.POSITIVE_INFINITY,
    });
    setBuffer(next);
    return () => {
      next.dispose();
      setBuffer(null);
    };
  }, [clock, seatKey]);

  useEffect(() => {
    if (!buffer) return;
    for (const msg of snapshot) {
      if (pinned.current.has(msg.id)) continue;
      const ut = revealUtFor(msg, me, pairs);
      // A no-path message never enters the buffer: it has no instant to be
      // released at, and holding it forever is the failure mode the unsent
      // state exists to avoid. It is not pinned either, so a pair matrix
      // arriving later can still give it one.
      if (ut === null) continue;
      pinned.current.set(msg.id, ut);
      buffer.push({ ut, data: msg, keyframe: true, bytes: 1 });
    }
  }, [buffer, snapshot, me, pairs]);

  return useMemo(() => {
    if (!thread) return EMPTY_FEED;
    const revealedIds = new Set(revealed.map((m) => m.id));
    const inTransit: CommsMessage[] = [];
    const unsent: CommsMessage[] = [];
    for (const msg of snapshot) {
      if (revealedIds.has(msg.id)) continue;
      if (pinned.current.has(msg.id)) inTransit.push(msg);
      else unsent.push(msg);
    }
    inTransit.sort(byArrivalAt(me, pairs));
    return { revealed, inTransit, unsent };
  }, [thread, snapshot, revealed, me, pairs]);
}

/** Re-export so a caller needs one import for the feed and its vocabulary. */
export { deliveryFor };
