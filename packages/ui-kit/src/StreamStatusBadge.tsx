import type { StreamStatusValue } from "@ksp-gonogo/sitrep-sdk"; // erased at build; no runtime edge
import styled from "styled-components";

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
 * each adopted the same `useDataStreamStatus` -> badge pattern independently
 * and left a "follow-up to extract" comment. This is that follow-up.
 */
export function formatStreamStatus(status: StreamStatusValue): string | null {
  switch (status) {
    case "live":
      return null;
    case "held-stale":
      return "STALE";
    case "last-before-blackout":
      return "STALE";
    case "disconnected":
      return "OFFLINE";
    case "resyncing":
      return "SYNCING";
    case "absent":
      return "NO DATA";
  }
}

/**
 * Small connectivity badge for a widget's title row. Renders nothing when
 * `status` is `"live"`, callers don't need to gate on `formatStreamStatus`
 * themselves.
 *
 * Most widgets should not render this by hand at all: `Panel` derives the
 * status from the widget's own registered `dataRequirements` and puts the
 * badge in its header. Reach for this directly only for a status that is not
 * the panel's own (a sub-region reading a different topic).
 */
export function StreamStatusBadge({ status }: StreamStatusBadgeProps) {
  const label = formatStreamStatus(status);
  if (label === null) return null;
  return (
    <StreamStatusBadge__Root role="status" aria-live="polite">
      {label}
    </StreamStatusBadge__Root>
  );
}

const StreamStatusBadge__Root = styled.span`
  flex: 0 0 auto;
  font-size: var(--font-size-2xs, 10px);
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: var(--space-hair, 1px) var(--space-6, 6px);
  border-radius: var(--radius-sm, 3px);
  color: var(--color-status-warning-bg);
  border: 1px solid var(--color-status-warning-bg);
  white-space: nowrap;
`;
