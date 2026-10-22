import { useTelemetry, useTimeContexts } from "@ksp-gonogo/core";
import { collapseControlStateLevel } from "@ksp-gonogo/sitrep-client";
import { useViewUt, type Value, value } from "@ksp-gonogo/sitrep-sdk";
import { SignalLossBanner, type SignalState } from "@ksp-gonogo/ui";
import { useEffect, useRef, useState } from "react";

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
 * Strength at or below this reads as "0% signal" ⇒ no-signal. Tiny (a
 * float-noise guard), not a "weak link" threshold: a genuinely weak-but-present
 * link (e.g. 1%) must not flash the banner, only an effectively-zero reading.
 */
const NO_SIGNAL_STRENGTH_EPSILON = value("ratio", 1e-6);

/**
 * How long the link report must be missing before the banner says it is
 * awaited, so a link that answers at once never flashes it.
 */
const AWAITING_GRACE_MS = 1500;

export function SignalLossIndicator() {
  const linkReading = useTelemetry("comms.link");
  const { owltSeconds } = useTimeContexts();
  const linkPending = linkReading.state === "pending";
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

  const state: SignalState =
    linkPending && graceElapsed
      ? "awaiting"
      : deriveState(
          connected,
          signalStrength,
          controlState,
          hasConfirmedConnection,
        );

  const viewUt = useViewUt();
  const lostSinceRef = useRef<Value<"ut"> | null>(null);

  // Reset the "since" instant whenever we cross in/out of "connected".
  if (state === "connected" || state === "awaiting") {
    lostSinceRef.current = null;
  }
  if (
    state !== "connected" &&
    state !== "awaiting" &&
    lostSinceRef.current === null &&
    viewUt !== undefined
  ) {
    lostSinceRef.current = viewUt;
  }

  // Game time, so the timer keeps pace with a warp; a UT that steps back (a quickload) reads 0 rather than a negative.
  const elapsed =
    lostSinceRef.current === null || viewUt === undefined
      ? value("s", 0)
      : viewUt.minus(lostSinceRef.current);

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
  const zeroSignal = signalStrength?.lessThanOrEqual(
    NO_SIGNAL_STRENGTH_EPSILON,
  );
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
