import { useDataValue } from "@gonogo/core";
import { BannerPill } from "@gonogo/ui";
import { useEffect, useState } from "react";

/**
 * Shows a warning banner when the Telemachus antenna's `p.paused`
 * indicates the link is unreliable (codes 2/3/4 — no power / off /
 * not found). This is the canonical "telemetry untrusted" signal
 * since the 2026-05-18 live-test rewire of the trust gate:
 * `BufferedDataSource` drops blocklist samples (`f.throttle`,
 * `v.sasValue`, `land.*`, `therm.*`, etc.) when this state is
 * active, and without a visual cue the operator sees their last
 * known throttle / SAS state with no idea it's stale.
 *
 * Distinct from SignalLossIndicator, which tracks vanilla KSP CommNet
 * (the mission-control link). The two states are independent:
 *  - CommNet down but antenna up = no mission link, telemetry still
 *    honest.
 *  - Antenna down but CommNet up = telemetry frozen, mission link
 *    still nominally there.
 * Both can be true at once; both banners will then show.
 *
 * Code 1 (game paused) is treated as nominal — values are frozen but
 * still real. Code 5 (not in flight scene — Space Center / Editor /
 * Tracking Station) is also skipped: there's no "antenna" concept
 * in those scenes, so flagging it as a problem would be misleading.
 * The other scene-aware banners (SceneSwitchPrompt etc.) handle
 * those transitions.
 *
 * Cold-start guard mirrors SignalLossIndicator: only flash the banner
 * after we've observed at least one good `p.paused === 0`. A cold
 * load where the data source hasn't reported yet should not surface
 * as an "antenna offline" alarm.
 */
export function TelemachusAntennaBanner() {
  const paused = useDataValue("data", "p.paused");
  const [hasConfirmedGood, setHasConfirmedGood] = useState(false);

  useEffect(() => {
    if (paused === 0) setHasConfirmedGood(true);
  }, [paused]);

  if (!hasConfirmedGood) return null;
  if (typeof paused !== "number") return null;
  if (paused === 0 || paused === 1 || paused === 5) return null;
  // 2/3/4 — antenna is offline in some way. Fork bug collapses all
  // three to 2; we still render a meaningful label for each in case
  // a future fork fixes the collapse.

  return (
    <BannerPill accent="var(--color-status-warning-bg)" pulse role="status">
      {labelFor(paused)}
    </BannerPill>
  );
}

function labelFor(paused: number): string {
  switch (paused) {
    case 2:
      return "TELEMACHUS ANTENNA OFFLINE — VESSEL TELEMETRY FROZEN";
    case 3:
      return "TELEMACHUS ANTENNA OFF — VESSEL TELEMETRY FROZEN";
    case 4:
      return "TELEMACHUS ANTENNA MISSING — VESSEL TELEMETRY FROZEN";
    default:
      return "TELEMACHUS ANTENNA UNRELIABLE — VESSEL TELEMETRY FROZEN";
  }
}
