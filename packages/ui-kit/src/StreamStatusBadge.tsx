import type { StreamStatusValue } from "@ksp-gonogo/sitrep-sdk";
import { Badge } from "./Badge";
import { LiveRegion } from "./LiveRegion";
import { severityFromStreamStatus } from "./status/severity";
import { formatStreamStatus } from "./status/streamStatusWord";

/**
 * Props for {@link StreamStatusBadge}.
 *
 * @category Badge
 */
export interface StreamStatusBadgeProps {
  /** The stream status to show. */
  status: StreamStatusValue;
}

/**
 * A small `sm` {@link Badge} for a stream status: the status's word, as
 * {@link formatStreamStatus} writes it, in its severity, or nothing while the
 * status is `live`. It sits inside a polite live region that stays
 * mounted while empty, so the first change away from `live` is announced.
 *
 * The dashboard sets `recorded` and `last-before-blackout` itself from a
 * widget's declared channels and shows them in the panel header, so a widget
 * does not draw this for those. Use it for a status that is not the
 * panel's own (a sub-region reading a different Topic), or pass a status to
 * {@link Panel}'s `panelStatus` prop.
 *
 * @category Badge
 */
export function StreamStatusBadge({ status }: StreamStatusBadgeProps) {
  const label = formatStreamStatus(status);
  return (
    <LiveRegion>
      {label !== null && (
        <Badge tone={severityFromStreamStatus(status)} size="sm">
          {label}
        </Badge>
      )}
    </LiveRegion>
  );
}
