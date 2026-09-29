import type { StreamStatusValue } from "@ksp-gonogo/sitrep-sdk";
import { Badge } from "./Badge";
import { LiveRegion } from "./LiveRegion";
import { severityFromStreamStatus } from "./status/severity";
import { formatStreamStatus } from "./status/streamStatusWord";

export interface StreamStatusBadgeProps {
  /** Current stream/connectivity status for the widget's representative key. */
  status: StreamStatusValue;
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
