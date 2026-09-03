import { DelayedPlayoutBuffer } from "@ksp-gonogo/sitrep-sdk/media";
import { useUtNow, useViewClockOptional } from "@ksp-gonogo/sitrep-sdk/spine";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommcastLog } from "./CommcastLog";
import {
  isSettled,
  revealUtFor,
  type SeparationMatrix,
  sentArrivalUtFor,
  sentPhaseFor,
  type Vantage,
} from "./reveal";
import type {
  CommcastLogSnapshot,
  CommsMessage,
  OutboundMessage,
} from "./types";
import { EMPTY_COMMCAST_LOG } from "./types";

/**
 * One entry in the conversation as it reads at this screen: either something
 * that arrived, or something this screen said that has settled.
 *
 * They are one list because a conversation is one list. What separates them is
 * `out`: present means this screen was the author, and carries the
 * acknowledgement ledger the row draws its verdict from.
 */
export interface CommcastEntry {
  msg: CommsMessage;
  out?: OutboundMessage;
}

/**
 * What one vantage can currently see.
 *
 * Two lists, and the split is the terminal widget's in line mode: what is in the
 * BUFFER, and what is still in the uplink queue. There is deliberately no
 * third list of messages on their way here. A message crossing toward this
 * screen is simply ABSENT until it lands, the way a terminal frame is, and
 * announcing "somebody is saying something you cannot hear yet" would be the
 * faster-than-light channel the whole design avoids.
 */
export interface CommcastFeed {
  /** In the order it landed HERE. Never reordered. */
  log: readonly CommcastEntry[];
  /** This screen's own words, still on their round trip, in send order. */
  outbound: readonly OutboundMessage[];
}

const EMPTY_FEED: CommcastFeed = { log: [], outbound: [] };

/**
 * Runs the arrival rule for one vantage.
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
 * `sentUt + 2S`, a round trip for a one-way crossing.
 *
 * Release ORDER is why the buffer earns its place over a sort. Sorting the
 * whole log by reveal instant retroactively inserts: a straggler that reaches
 * this screen now, carrying a reveal instant in the past, would land above
 * messages the operator has already read. The buffer appends in RELEASE order,
 * so a backlog replays in its own historical order and a straggler lands at the
 * end, where it honestly arrived.
 *
 * This screen's OWN words go through the same buffer on a different instant:
 * not when they were spoken, but when they settled (`sentArrivalUtFor`). That
 * is what makes an author's own line and the reply answering it land together,
 * the way the terminal widget's own line-mode echo and its output do.
 */
export function useCommcastFeed(
  log: CommcastLog | null,
  me: Vantage,
  pairs?: SeparationMatrix,
): CommcastFeed {
  const clock = useViewClockOptional();
  const utNow = useUtNow();
  const [snapshot, setSnapshot] = useState<CommcastLogSnapshot>(
    () => log?.snapshot() ?? EMPTY_COMMCAST_LOG,
  );
  const [landed, setLanded] = useState<readonly CommcastEntry[]>([]);

  useEffect(() => {
    if (!log) {
      setSnapshot(EMPTY_COMMCAST_LOG);
      return;
    }
    setSnapshot(log.snapshot());
    return log.subscribe(setSnapshot);
  }, [log]);

  // The buffer is rebuilt whenever this vantage changes, because every reveal
  // instant in it was computed against that vantage. Its first arrival (from
  // `undefined` to a real centre) is the common case.
  const seatKey = `${me.seat}|${me.vantageId ?? ""}`;
  /**
   * Each message's landing instant, pinned the first time it is resolved.
   *
   * Having resolved one, the feed must not re-read it: a separation that grows
   * afterwards would move the instant later and un-deliver something already
   * on screen.
   */
  const pinned = useRef<Map<string, number>>(new Map());
  /**
   * Which buffer the pins above belong to.
   *
   * Load-bearing, and it is what a bare `pinned.current = new Map()` in the
   * rebuild effect gets wrong. Effects run in declaration order, so on the
   * commit that rebuilds the buffer the PUSH effect below still closes over the
   * previous, now-disposed buffer while the map has already been cleared: it
   * re-pins every message and pushes it into a buffer that silently ignores
   * pushes, and the next commit sees a full map and pushes nothing. The
   * messages are then pinned to a buffer that will never release them and
   * disappear from the log entirely.
   *
   * Clearing the map HERE, against the buffer the push actually holds, makes
   * that impossible: a stale pass leaves the pins alone and does nothing, and
   * the pass that has the new buffer is the one that re-pins.
   *
   * This is the defect behind the render harness's "lost the arrival race",
   * which the previous pass could reproduce and not explain. The rebuild is
   * triggered by the observed vantage arriving, which happens on every fresh
   * page load, so it is not a harness-only fault.
   */
  const pinnedBuffer = useRef<DelayedPlayoutBuffer<CommcastEntry> | null>(null);
  const [buffer, setBuffer] =
    useState<DelayedPlayoutBuffer<CommcastEntry> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `seatKey` is the identity of the reader's vantage, which every pinned instant was computed against. The body reads it only through those instants, so this dep is the only thing that can rebuild the buffer when the vantage changes.
  useEffect(() => {
    if (!clock) {
      setBuffer(null);
      return;
    }
    setLanded([]);
    const next = new DelayedPlayoutBuffer<CommcastEntry>({
      view: {
        confirmedEdgeUt: () => clock.utNowEstimate(),
        onFrame: (cb) => clock.onFrame(cb),
      },
      onRelease: (frame) => {
        const entry = frame.data;
        if (!entry) return;
        setLanded((prev) => [...prev, entry]);
      },
      /*
       * A message is never evicted for size: dropping somebody's words to save
       * bytes would be the one failure this feature cannot afford, and a typed
       * message does not approach any cap worth having.
       */
      maxBufferedBytes: Number.POSITIVE_INFINITY,
    });
    setBuffer(next);
    return () => {
      next.dispose();
      setBuffer(null);
    };
  }, [clock, seatKey]);

  /*
   * Re-run per frame, not only per snapshot. A sent message has no landing
   * instant until either an acknowledgement reaches this screen or its wait
   * runs out, and the wait running out is a clock comparison with nothing to
   * notify on. `utNow` is the frame tick the widget already re-renders on, so
   * this costs no extra render.
   */
  useEffect(() => {
    if (!buffer || !log || utNow === undefined) return;
    if (pinnedBuffer.current !== buffer) {
      pinnedBuffer.current = buffer;
      pinned.current = new Map();
    }
    const fresh: { ut: number; entry: CommcastEntry }[] = [];
    /*
     * The inbox goes through the buffer too, not straight onto the screen, so
     * a log rebuilt from storage replays in the order it was HEARD rather than
     * in whatever order the wire happened to deliver it.
     */
    for (const msg of [...snapshot.inbox, ...snapshot.pending]) {
      if (pinned.current.has(msg.id)) continue;
      const ut = revealUtFor(msg, me, pairs);
      // No path from where it was spoken to here. It is not pinned, so a pair
      // matrix arriving later can still give it an instant, and it is shown
      // nowhere in the meantime: at this vantage it has not happened.
      if (ut === null) continue;
      fresh.push({ ut, entry: { msg } });
    }
    for (const out of snapshot.outbox) {
      if (pinned.current.has(out.msg.id)) continue;
      const ut = sentArrivalUtFor(out, me, utNow, pairs);
      if (ut === undefined) continue;
      fresh.push({ ut, entry: { msg: out.msg, out } });
    }
    /*
     * Sorted before pushing, because the buffer releases a BACKLOG in the
     * order it was pushed. Everything already due comes out on the next frame
     * together, so with an unsorted push a log restored from storage read in
     * list order: a message the operator heard first appearing under one they
     * heard later. Sorting only the batch is enough, since anything pushed on
     * a later pass is by definition later still.
     */
    fresh.sort(
      (a, b) => a.ut - b.ut || a.entry.msg.sentUt - b.entry.msg.sentUt,
    );
    for (const { ut, entry } of fresh) {
      pinned.current.set(entry.msg.id, ut);
      buffer.push({ ut, data: entry, keyframe: true, bytes: 1 });
    }
  }, [buffer, log, snapshot, me, pairs, utNow]);

  /*
   * Acknowledge on RELEASE, at the instant the message arrived rather than the
   * instant this ran. What is delayed is the author LEARNING it, not the
   * reading, so recording it the moment the operator can see the message is
   * the honest instant; and stamping it with the arrival rather than with now
   * keeps a screen that was closed for the crossing from reporting a round
   * trip that reflects its owner's browsing rather than the geometry.
   */
  const acked = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!log || me.vantageId === undefined) return;
    for (const entry of landed) {
      if (entry.out) continue;
      if (acked.current.has(entry.msg.id)) continue;
      acked.current.add(entry.msg.id);
      // A message already in the inbox was released on an earlier mount, and
      // `release` finds nothing to move, so this cannot acknowledge twice.
      const at = pinned.current.get(entry.msg.id);
      if (at === undefined) continue;
      log.release(entry.msg.id, {
        from: me.vantageId,
        stationKey: log.screenKey,
        seat: me.seat,
        atUt: at,
      });
    }
  }, [landed, log, me.vantageId, me.seat]);

  return useMemo(() => {
    if (!log) return EMPTY_FEED;
    const landedIds = new Set(landed.map((e) => e.msg.id));
    /*
     * Redrawn from the CURRENT outbox rather than from the entry the buffer
     * released, because an acknowledgement can arrive after the message
     * landed: a message that went overdue and is answered late has to stop
     * saying it was never confirmed.
     */
    const byId = new Map(snapshot.outbox.map((o) => [o.msg.id, o]));
    const entries = landed.map((e) =>
      e.out ? { msg: e.msg, out: byId.get(e.msg.id) ?? e.out } : e,
    );
    const outbound = snapshot.outbox.filter(
      (o) =>
        !landedIds.has(o.msg.id) &&
        !isSettled(
          sentPhaseFor(o, me, utNow ?? Number.NEGATIVE_INFINITY, pairs),
        ),
    );
    return { log: entries, outbound };
  }, [log, snapshot, landed, me, pairs, utNow]);
}
