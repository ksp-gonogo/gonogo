import type { StreamStatusValue } from "@ksp-gonogo/sitrep-sdk"; // erased at build; no runtime edge
import { Badge } from "./Badge";
import { severityFromStreamStatus } from "./status/severity";

export interface StreamStatusBadgeProps {
  /** Current stream/connectivity status for the widget's representative key. */
  status: StreamStatusValue;
}

/**
 * `StreamStatusValue` -> a short badge caption, or `null` for `"live"`.
 *
 * `null` is the whole design: a healthy stream shows NOTHING. There is no
 * green "OK" pill, because a pill that is present in the normal case teaches
 * the operator to stop seeing it, and this badge only matters in the
 * abnormal one.
 *
 * Extracted from the four widgets that grew an identical copy during the M3
 * migration pilot (`WarpControl`, `Navball`, `ThermalStatus`, `FuelStatus`):
 * each adopted the same read-the-status, render-a-badge pattern independently
 * and left a "follow-up to extract" comment. This is that follow-up.
 */
export function formatStreamStatus(status: StreamStatusValue): string | null {
  switch (status) {
    case "live":
      return null;
    case "held-stale":
      return "STALE";
    case "last-before-blackout":
      // Its own word, not "STALE". The two grades mean "not current" and ask
      // the operator for opposite moves: STALE is a producer whose updates
      // stopped arriving, something to go and check, where this is the last
      // reading that got out before the craft went behind something, and there
      // is nothing to check and nothing to do but wait for acquisition. One
      // caption for both said only "old" and threw the actionable half away.
      // Same `warning` severity: still not current, still not a fault.
      return "BLACKOUT";
    case "recorded":
      // Its own word, not "STALE". A recorded reading is EXACT for the instant
      // it names; calling it stale would claim uncertainty the value does not
      // have, and calling it nothing would read as live. "RECORDED" is what the
      // operator needs to know: this came off the craft, not off the link.
      return "RECORDED";
    case "disconnected":
      return "OFFLINE";
    case "resyncing":
      return "SYNCING";
    case "absent":
      return "NO DATA";
  }
}

/**
 * Small connectivity badge for a widget's title row, now a thin adapter over the
 * canonical `Badge`: it maps a `StreamStatusValue` onto a `Severity` and renders
 * the pill, preserving the "render nothing when live" rule by returning `null`
 * at the floor. Announces as a live region, since a stream degrading is exactly
 * the kind of state change an operator benefits from being told about.
 *
 * A widget does not render this by hand for a blackout: the dashboard host
 * derives `recorded` / `last-before-blackout` across the widget's declared
 * channels and puts the badge in the panel header through the status store.
 * Reach for this directly for a status that is not the panel's own (a
 * sub-region reading a different topic), or for one of the grades the host
 * does not derive; `Panel`'s `panelStatus` says which and why.
 */
export function StreamStatusBadge({ status }: StreamStatusBadgeProps) {
  const label = formatStreamStatus(status);
  if (label === null) return null;
  return (
    <Badge severity={severityFromStreamStatus(status)} size="sm" live>
      {label}
    </Badge>
  );
}
