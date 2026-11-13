import {
  isAwaitingFirstSignal,
  useTelemetry,
  useTimeContexts,
} from "@ksp-gonogo/core";
import { collapseControlStateLevel } from "@ksp-gonogo/sitrep-client";
import {
  useViewClockOptional,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { SignalLossBanner, type SignalState } from "@ksp-gonogo/ui";
import { useEffect, useState } from "react";

/**
 * Wires `SignalLossBanner` to the live CommNet state.
 *
 * Signal state is derived from:
 *  - `comms.link.connected`: is there a link to KSC at all? Read off the
 *    dedicated Delayed, freeze-EXEMPT `comms.link` MetaTopic (not the frozen
 *    `vessel.comms` struct), so a disconnect edge actually reaches the client
 *    through a blackout and flips the banner (comms-delay-model-consistency
 *    spec: a Delayed `vessel.comms.connected` froze at last-known, so the
 *    banner could never fire).
 *  - `vessel.comms.signalStrength`: 0..1 link strength. A last-known reading
 *    of ~0 ("0% signal") reads as no-signal even if `connected` was never
 *    observed false, so a link that decays to nothing still shows signal loss.
 *  - `vessel.comms.controlState`: the raw `ControlState` enum, collapsed to
 *    CommSignal's 0/1/2 level via the SharedLib `collapseControlStateLevel`:
 *    0 no control, 1 partial, 2 full. Stays on the frozen
 *    `vessel.comms` struct: control state should freeze at last-known.
 *
 * With no stream mounted, or no vessel active, we stay in the "connected" state
 * so the banner stays hidden: the banner is for genuine blackouts, not absence
 * of data. A link report still on its way is the "awaiting" state, shown once it
 * has been missing for a moment.
 *
 * Elapsed time is measured in game time from the instant the state last left
 * "connected", so it keeps pace with time warp.
 */

/**
 * Only a strength of exactly nothing reads as "0% signal". A relayed path's
 * strength is the product of its hops, so a long chain of live links is
 * legitimately tiny (nine hops near their range come to about 1e-8) and must
 * not read as a lost link.
 */
const NO_SIGNAL_STRENGTH = value("ratio", 0);

/**
 * How long the link report must be missing before the banner says it is
 * awaited, so a link that answers at once never flashes it.
 */
const AWAITING_GRACE_MS = 1500;

let heldLoss: {
  since: Value<"ut">;
  floor: Value<"ut">;
  craft: string | undefined;
} | null = null;

/** Pins a loss to the craft it is first seen on, and drops it when the active craft changes. */
function withCraft(loss: NonNullable<typeof heldLoss>, craftId: string) {
  if (loss.craft === undefined) return { ...loss, craft: craftId };
  return loss.craft === craftId ? loss : null;
}

/** Forgets a loss the indicator is carrying across a remount, for tests that share a module. */
export function forgetHeldSignalLoss(): void {
  heldLoss = null;
}

export function SignalLossIndicator() {
  const linkReading = useTelemetry("comms.link");
  const { owltSeconds } = useTimeContexts();
  const linkPending = isAwaitingFirstSignal(linkReading);
  const [graceElapsed, setGraceElapsed] = useState(false);
  useEffect(() => {
    if (!linkPending) {
      setGraceElapsed(false);
      return;
    }
    const id = setTimeout(() => {
      setGraceElapsed(true);
    }, AWAITING_GRACE_MS);
    return () => clearTimeout(id);
  }, [linkPending]);
  const commsReading = useTelemetry("vessel.comms");
  // FAIL-OPEN FIX, not merely a migration. An indicator whose loss gate stops
  // gating either never shows loss or always does, and both are worse than what
  // it did before.
  //
  // A LINK is the one thing silence is evidence about, so a held one reads as
  // unknown rather than as its last value: painting "connected" from a
  // last-known true asserts the fact the silence contradicts. `undefined` is
  // already this component's not-yet-known state, and the confirmed-true gate
  // below still governs whether a false counts as a blackout.
  const connected =
    linkReading.state === "observed"
      ? (linkReading.value.connected ?? undefined)
      : undefined;
  const signalStrength =
    commsReading.state === "observed"
      ? commsReading.value.signalStrength
      : undefined;
  // Warmup and a disconnected-vessel TOMBSTONE are now two named arms rather
  // than one `== null`, which is the distinction that mattered here all along:
  // `vessel.comms` goes absent the moment a vessel is comms-dark, and reading
  // `.controlState` off it crashed the whole app during a NORMAL signal-loss
  // state. Control state is simply unknown in both cases; the loss itself is
  // driven by `connected`/`signalStrength` above.
  const controlState =
    commsReading.state === "observed"
      ? collapseControlStateLevel(commsReading.value.controlState)
      : undefined;

  // Mirror `BufferedDataSource`'s gate: only trust a `false` as a blackout
  // AFTER we've observed a confirmed `true`. Cold-start false (no vessel,
  // CommNet off, no antenna) must not flash the banner. Without this the
  // banner stayed up permanently for any user whose KSP never reports true.
  const [hasConfirmedConnection, setHasConfirmedConnection] = useState(false);
  useEffect(() => {
    if (connected === true) setHasConfirmedConnection(true);
  }, [connected]);

  const derived: SignalState =
    linkPending && graceElapsed && heldLoss === null
      ? "awaiting"
      : deriveState(
          connected,
          signalStrength,
          controlState,
          hasConfirmedConnection || heldLoss !== null,
        );
  /*
   * A link report that is held or not yet in, as after a host change or a
   * rejoin, says nothing about whether the loss ended, so a loss already under
   * way stays a loss until one says so. A report that is merely slow to arrive
   * stays quiet for the same grace the awaiting state waits.
   */
  const state: SignalState =
    derived === "connected" &&
    connected === undefined &&
    (!linkPending || graceElapsed) &&
    heldLoss !== null
      ? "lost"
      : derived;

  /*
   * Read on a 1 s timer, and only while a banner is up, rather than through
   * `useViewUt`, which re-renders on every animation frame for as long as the
   * indicator is mounted. A banner timer in whole game seconds has no use for
   * 60 renders a second, and a healthy link needs none at all.
   */
  const clock = useViewClockOptional();
  const [, setTick] = useState(0);
  const banner = state !== "connected" && state !== "awaiting";
  useEffect(() => {
    if (!banner) return;
    const id = setInterval(() => {
      setTick((n) => n + 1);
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [banner]);
  const edge = clock?.confirmedEdgeUt();
  const viewUt =
    edge !== undefined && Number.isFinite(edge) ? value("ut", edge) : undefined;
  /*
   * The loss start survives a rejoin: after a station reconnects, `comms.link`
   * is pending until the first report lands, and that wait reads as "connected"
   * and then "awaiting" without the link ever having been seen up. Only a
   * link report that says the link is up ends the loss, and so does a change of
   * active craft, which is a different loss.
   *
   * It is kept at module scope because a host change rebuilds the stream client
   * and unmounts everything below the provider, this component included. The
   * start is a game UT, which every host shares, so it stays true across that.
   */
  const identityReading = useTelemetry("vessel.identity");
  const craftId =
    identityReading.state === "observed" || identityReading.state === "held"
      ? identityReading.value.vesselId
      : undefined;
  if (craftId !== undefined && heldLoss !== null) {
    heldLoss = withCraft(heldLoss, craftId);
  }
  /*
   * A host that takes over replays the link's history, whose "up" readings
   * pre-date the loss and do not end it. `floor` is when the drop was
   * reported to have happened, so only an "up" after it does.
   */
  const reportedAt =
    linkReading.state === "observed" ? linkReading.atUt : undefined;
  const upBeforeTheDrop =
    reportedAt !== undefined &&
    heldLoss !== null &&
    reportedAt.lessThanOrEqual(heldLoss.floor);
  if (state === "connected" && connected === true && !upBeforeTheDrop) {
    heldLoss = null;
  }
  if (banner && heldLoss === null && viewUt !== undefined) {
    heldLoss = {
      since: viewUt,
      floor:
        connected === false && reportedAt !== undefined ? reportedAt : viewUt,
      craft: craftId,
    };
  }
  const lostSince = heldLoss?.since ?? null;

  // Game time, so the timer keeps pace with a warp; a UT that steps back (a quickload) reads 0 rather than a negative.
  const elapsed =
    lostSince === null || viewUt === undefined
      ? value("s", 0)
      : viewUt.minus(lostSince);

  return (
    <SignalLossBanner
      state={state}
      elapsed={elapsed.lessThan(value("s", 0)) ? value("s", 0) : elapsed}
      expectedIn={owltSeconds > 0 ? owltSeconds : undefined}
    />
  );
}

/**
 * "Lost" is bound to a confirmed disconnect (`comms.link.connected === false`)
 * or an effectively-zero signal strength: both gated on having seen a
 * confirmed-true link first, so a cold-start false / 0% (no vessel, CommNet
 * off, no antenna) never flashes the banner. This keeps it honest: when it says
 * signal loss, the link really is down or at 0%. `controlState` low without
 * disconnection (crewed ship missing its pilot etc.) is informational only and
 * shown as partial.
 */
export function deriveState(
  connected: boolean | undefined,
  signalStrength: Value<"ratio"> | undefined,
  controlState: number | undefined,
  hasConfirmedConnection: boolean,
): SignalState {
  // "Lost" only when we've seen a confirmed-true previously. Matches
  // `BufferedDataSource`'s gate: if the user's KSP never asserts a link
  // (CommNet off, no antenna, no vessel), the banner stays hidden and data
  // continues to flow: the UI being quiet is more honest than flashing SIGNAL
  // LOSS while live samples arrive. 0% strength is equivalent to not-connected
  // (a link that decayed to nothing), so it trips the same "lost" state.
  const zeroSignal = signalStrength?.lessThanOrEqual(NO_SIGNAL_STRENGTH);
  if ((connected === false || zeroSignal) && hasConfirmedConnection) {
    return "lost";
  }
  // "Partial" only when we've heard an affirmative connect. A stray
  // `controlState: 0` arriving before `connected` doesn't flash the banner.
  if (connected === true && (controlState === 0 || controlState === 1)) {
    return "partial";
  }
  return "connected";
}
