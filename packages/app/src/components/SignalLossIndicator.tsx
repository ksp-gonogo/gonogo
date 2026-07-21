import { useTelemetry } from "@ksp-gonogo/core";
import { collapseControlStateLevel } from "@ksp-gonogo/sitrep-client";
import { SignalLossBanner, type SignalState } from "@ksp-gonogo/ui";
import { useEffect, useRef, useState } from "react";

/**
 * Wires `SignalLossBanner` to the live CommNet state.
 *
 * Signal state is derived from:
 *  - `comms.link.connected` — is there a link to KSC at all? Read off the
 *    dedicated Delayed, freeze-EXEMPT `comms.link` MetaTopic (NOT the frozen
 *    `vessel.comms` struct), so a disconnect edge actually reaches the client
 *    through a blackout and flips the banner (comms-delay-model-consistency
 *    spec — a Delayed `vessel.comms.connected` froze at last-known, so the
 *    banner could never fire).
 *  - `vessel.comms.signalStrength` — 0..1 link strength. A last-known reading
 *    of ~0 ("0% signal") reads as no-signal even if `connected` was never
 *    observed false, so a link that decays to nothing still shows SIGNAL LOSS.
 *  - `vessel.comms.controlState` — the raw `ControlState` enum, collapsed to
 *    CommSignal's 0/1/2 level via the SharedLib `collapseControlStateLevel`
 *    (the same collapse behind the derived `vessel.state.commsControlStateOrdinal`
 *    channel): 0 no control, 1 partial, 2 full. Stays on the frozen
 *    `vessel.comms` struct — control state SHOULD freeze at last-known.
 *
 * Until the stream reports these topics (warmup, no vessel active, or no
 * provider mounted) we stay in the "connected" state so the banner stays
 * hidden — the banner is for genuine blackouts, not absence of data.
 *
 * Elapsed time is measured from the moment the state last left "connected".
 * A 1s interval ticks a render to keep the timer label fresh.
 */

/**
 * Strength at or below this reads as "0% signal" ⇒ no-signal. Tiny (a
 * float-noise guard), not a "weak link" threshold: a genuinely weak-but-present
 * link (e.g. 1%) must NOT flash the banner — only an effectively-zero reading.
 */
const NO_SIGNAL_STRENGTH_EPSILON = 1e-6;

export function SignalLossIndicator() {
  const link = useTelemetry("comms.link");
  const comms = useTelemetry("vessel.comms");
  const connected = link?.connected;
  const signalStrength = comms?.signalStrength;
  // `comms == null` catches BOTH warmup (`undefined`) AND a disconnected-vessel
  // TOMBSTONE (`null`) — `vessel.comms` goes null the moment a vessel is
  // comms-dark, and reading `.controlState` off it crashed the whole app
  // (error-boundary) during a NORMAL signal-loss state. Control state is simply
  // unknown then; the loss itself is driven by `connected`/`signalStrength`.
  const controlState =
    comms == null ? undefined : collapseControlStateLevel(comms.controlState);

  // Mirror `BufferedDataSource`'s gate: only trust a `false` as a blackout
  // AFTER we've observed a confirmed `true`. Cold-start false (no vessel,
  // CommNet off, no antenna) must not flash the banner. Without this the
  // banner stayed up permanently for any user whose KSP never reports true.
  const [hasConfirmedConnection, setHasConfirmedConnection] = useState(false);
  useEffect(() => {
    if (connected === true) setHasConfirmedConnection(true);
  }, [connected]);

  const state = deriveState(
    connected,
    signalStrength,
    controlState,
    hasConfirmedConnection,
  );

  const lostSinceRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Reset the "since" timestamp whenever we cross in/out of "connected".
  useEffect(() => {
    if (state === "connected") {
      lostSinceRef.current = null;
    } else if (lostSinceRef.current === null) {
      lostSinceRef.current = Date.now();
    }
  }, [state]);

  // Periodic re-render for the timer label. Only while a banner is visible —
  // no point ticking when we're healthy.
  useEffect(() => {
    if (state === "connected") return;
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [state]);

  const elapsedMs =
    lostSinceRef.current === null ? 0 : Math.max(0, now - lostSinceRef.current);

  return <SignalLossBanner state={state} elapsedMs={elapsedMs} />;
}

/**
 * "Lost" is bound to a confirmed disconnect (`comms.link.connected === false`)
 * OR an effectively-zero signal strength — both gated on having seen a
 * confirmed-true link first, so a cold-start false / 0% (no vessel, CommNet
 * off, no antenna) never flashes the banner. This keeps it honest: when it says
 * SIGNAL LOSS, the link really is down or at 0%. `controlState` low without
 * disconnection (crewed ship missing its pilot etc.) is informational only and
 * shown as PARTIAL.
 */
export function deriveState(
  connected: boolean | undefined,
  signalStrength: number | undefined,
  controlState: number | undefined,
  hasConfirmedConnection: boolean,
): SignalState {
  // "Lost" only when we've seen a confirmed-true previously. Matches
  // `BufferedDataSource`'s gate: if the user's KSP never asserts a link
  // (CommNet off, no antenna, no vessel), the banner stays hidden and data
  // continues to flow — the UI being quiet is more honest than flashing SIGNAL
  // LOSS while live samples arrive. 0% strength is equivalent to not-connected
  // (a link that decayed to nothing), so it trips the same "lost" state.
  const zeroSignal =
    signalStrength !== undefined &&
    signalStrength <= NO_SIGNAL_STRENGTH_EPSILON;
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
