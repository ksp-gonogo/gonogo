import type { StreamStatusValue } from "@ksp-gonogo/sitrep-client";
import styled from "styled-components";

export interface StreamStatusBadgeProps {
  /** Current stream/connectivity status for the widget's representative key. */
  status: StreamStatusValue;
}

/**
 * `StreamStatusValue` -> a short badge caption, or `null` for `"live"` (the
 * default/common case — no badge at all, matching the widget's rendered
 * output for every unmigrated/still-legacy render).
 *
 * Extracted from the four widgets that grew an identical copy during the M3
 * migration pilot (`WarpControl`, `Navball`, `ThermalStatus`, `FuelStatus`) —
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
 * `status` is `"live"` — callers don't need to gate on `formatStreamStatus`
 * themselves, just render `<StreamStatusBadge status={streamStatus} />`
 * unconditionally next to the panel title.
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
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--color-status-warning-bg);
  border: 1px solid var(--color-status-warning-bg);
  white-space: nowrap;
`;
