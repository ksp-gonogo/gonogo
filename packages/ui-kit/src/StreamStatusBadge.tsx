import type { StreamStatusValue } from "@ksp-gonogo/sitrep-sdk";
import { Badge } from "./Badge";
import { LiveRegion } from "./LiveRegion";
import { severityFromStreamStatus } from "./status/severity";

export interface StreamStatusBadgeProps {
  /** Current stream/connectivity status for the widget's representative key. */
  status: StreamStatusValue;
}

/**
 * `StreamStatusValue` -> a short badge caption, or `null` for `"live"`.
 *
 * A healthy stream shows nothing: a pill present in the normal case teaches
 * the operator to stop seeing it.
 */
export function formatStreamStatus(status: StreamStatusValue): string | null {
  switch (status) {
    case "live":
      return null;
    case "held-stale":
      return "STALE";
    case "last-before-blackout":
      // Not "STALE": stale is something to go and check, a blackout is only something to wait out.
      return "BLACKOUT";
    case "recorded":
      // Not "STALE": a recorded reading is exact for the instant it names.
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
 * Small connectivity badge for a widget's title row: maps a
 * `StreamStatusValue` onto a `Severity` and draws the pill, or nothing while
 * `live`. It announces as a polite live region, which stays mounted while
 * empty so the first degradation is announced.
 *
 * A widget does not render this by hand for a blackout: the dashboard host
 * derives `recorded` and `last-before-blackout` across the widget's declared
 * channels and puts the badge in the panel header. Reach for this directly for
 * a status that is not the panel's own (a sub-region reading a different
 * topic), or for a grade the host does not derive; see `Panel`'s `panelStatus`.
 */
export function StreamStatusBadge({ status }: StreamStatusBadgeProps) {
  const label = formatStreamStatus(status);
  return (
    <LiveRegion>
      {label !== null && (
        <Badge severity={severityFromStreamStatus(status)} size="sm">
          {label}
        </Badge>
      )}
    </LiveRegion>
  );
}
