import { useTelemetry } from "@gonogo/core";
import { collapseControlStateLevel } from "@gonogo/sitrep-client";
import { SignalLossBanner, type SignalState } from "@gonogo/ui";
import { useEffect, useRef, useState } from "react";

/**
 * Wires `SignalLossBanner` to the live CommNet state, read canonically off the
 * `vessel.comms` stream Topic (`Sitrep.Contract.VesselComms`) — no legacy
 * Telemachus `"data"` read and no read-fallback (R6 de-Telemachus).
 *
 * Signal state is derived from:
 *  - `vessel.comms.connected` — is there a link to KSC at all?
 *  - `vessel.comms.controlState` — the raw `ControlState` enum, collapsed to
 *    CommSignal's 0/1/2 level via the SharedLib `collapseControlStateLevel`
 *    (the same collapse behind the derived `vessel.state.commsControlStateOrdinal`
 *    channel): 0 no control, 1 partial, 2 full.
 *
 * Until the stream reports `vessel.comms` (warmup, no vessel active, or no
 * provider mounted) we stay in the "connected" state so the banner stays
 * hidden — the banner is for genuine blackouts, not absence of data.
 *
 * Elapsed time is measured from the moment the state last left "connected".
 * A 1s interval ticks a render to keep the timer label fresh.
 */
export function SignalLossIndicator() {
  const comms = useTelemetry("vessel.comms");
  const connected = comms?.connected;
  const controlState =
    comms === undefined
      ? undefined
      : collapseControlStateLevel(comms.controlState);

  // Mirror `BufferedDataSource`'s gate: only trust a `false` as a blackout
  // AFTER we've observed a confirmed `true`. Cold-start false (no vessel,
  // CommNet off, no antenna) must not flash the banner. Without this the
  // banner stayed up permanently for any user whose KSP never reports true.
  const [hasConfirmedConnection, setHasConfirmedConnection] = useState(false);
  useEffect(() => {
    if (connected === true) setHasConfirmedConnection(true);
  }, [connected]);

  const state = deriveState(connected, controlState, hasConfirmedConnection);

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
 * "Lost" is deliberately bound to `comm.connected === false` only — the same
 * condition that triggers `BufferedDataSource`'s signal-loss gate. This keeps
 * the banner honest: when it says SIGNAL LOSS, telemetry really has stopped
 * flowing. `controlState` low without disconnection (crewed ship missing its
 * pilot etc.) is informational only and shown as PARTIAL.
 */
export function deriveState(
  connected: boolean | undefined,
  controlState: number | undefined,
  hasConfirmedConnection: boolean,
): SignalState {
  // "Lost" only when we've seen a confirmed-true previously and it flipped
  // to false. Matches `BufferedDataSource`'s gate: if the user's KSP never
  // asserts `comm.connected: true` (CommNet off, no antenna, no vessel),
  // the banner stays hidden and data continues to flow — the UI being
  // quiet is more honest than flashing SIGNAL LOSS while live samples
  // arrive.
  if (connected === false && hasConfirmedConnection) return "lost";
  // "Partial" only when we've heard an affirmative connect. A stray
  // `controlState: 0` arriving before `connected` doesn't flash the banner.
  if (connected === true && (controlState === 0 || controlState === 1)) {
    return "partial";
  }
  return "connected";
}
