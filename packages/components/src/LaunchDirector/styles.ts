import { Disclosure } from "@ksp-gonogo/ui-kit";
// biome-ignore lint/style/noRestrictedImports: type and layout treatments not yet expressed in kit primitives
import styled from "styled-components";

function occupancyColor(occupied: boolean | null): string {
  if (occupied === true) return "var(--color-go-text)";
  if (occupied === null) return "var(--color-text-muted)";
  return "var(--color-text-faint)";
}

export const SectionLabel = styled.div`
  font-size: var(--font-size-caption);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  margin-top: var(--gap-caption);
`;

export const PadList = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const PadCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const PadMeta = styled.span`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 1;
  min-width: 0;
`;

export const PadName = styled.span`
  font-size: var(--font-size-value);
  font-weight: 600;
  color: var(--color-text-primary);
`;

export const PadDetails = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
`;

// Unreported reads as a caution, so silence is never read as an empty pad.
export const PadOccupancy = styled.span<{ $occupied: boolean | null }>`
  font-size: var(--font-size-compact);
  flex-shrink: 0;
  text-align: right;
  color: ${(p) => occupancyColor(p.$occupied)};
`;

// Indented and one step down in size, so six pads with asides still read as a list.
export const PadAside = styled.div`
  padding-left: var(--indent-aside);
  font-size: var(--font-size-compact);
  &:empty {
    display: none;
  }
`;

export const PadDetail = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  padding-left: var(--indent-aside);
  border-left: 2px solid var(--color-border-subtle);
`;

// One track normally, two in a letterbox once a craft is picked; `align-items: start` keeps the crew column its own height.
export const CraftAndCrew = styled.div<{ $sideBySide: boolean }>`
  display: grid;
  grid-template-columns: ${(p) =>
    p.$sideBySide ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)"};
  align-items: start;
  gap: var(--gap-related);
`;

export const PadColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  min-width: 0;
`;

export const EmptyNote = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
  line-height: var(--line-height-body);
`;
// Not a list: `<button>` is not a valid child of `<ul>`.
export const ShipList = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const ShipMeta = styled.span`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 1;
  min-width: 0;
`;

export const ShipName = styled.span`
  font-size: var(--font-size-value);
  font-weight: 600;
  color: var(--color-text-primary);
`;

export const ShipDetails = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
`;

export const ShipCost = styled.span`
  display: inline-flex;
  gap: var(--gap-related);
  flex-shrink: 0;
`;

export const CostTag = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

export const BlockedTag = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-nogo-text);
  font-variant-numeric: tabular-nums;
`;

// Sits in the CRAFT column like a heading, so the trigger's UA centring and padding are undone.
export const CrewDisclosure = styled(Disclosure)`
  > button {
    padding-left: 0;
    text-align: left;
  }
  /* A section that folds, not a row that pops open, so the accordion chrome comes off. */
  > [role="group"] {
    padding: 0;
    background: none;
    border: none;
  }
`;

export const CrewGrid = styled.div<{ $compact: boolean }>`
  display: grid;
  grid-template-columns: repeat(
    auto-fit,
    minmax(${(p) => (p.$compact ? "170px" : "120px")}, 1fr)
  );
  gap: var(--gap-related);
`;

export const CrewName = styled.span`
  font-size: var(--font-size-value);
  font-weight: 600;
`;

export const CrewTrait = styled.span`
  font-size: var(--font-size-compact);
  color: inherit;
  opacity: 0.7;
  letter-spacing: 0.04em;
`;

export const LaunchControls = styled.div`
  display: flex;
  gap: var(--gap-related);
  margin-top: var(--gap-actions);
`;

export const PadActions = styled.div`
  display: flex;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

export const InFlightWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const FlightStats = styled.dl`
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const FlightStatRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--gap-row-wrap) var(--gap-label-value);
  /* A narrow widget drops the value onto its own line rather than clipping it. */
  flex-wrap: wrap;
  padding: var(--inset-surface);
  border-radius: var(--radius-regular);
  background: var(--color-surface-panel);
`;

export const StatLabel = styled.dt`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-dim);
  margin: 0;
`;

export const StatValue = styled.dd`
  margin: 0;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-primary);
  font-weight: 600;
  white-space: nowrap;
  margin-left: auto;
`;

export const CrashChip = styled.div`
  background: var(--color-nogo-muted);
  color: var(--color-nogo-text);
  font-size: var(--font-size-compact);
  padding: var(--inset-chip);
  border-radius: var(--radius-regular);
  letter-spacing: 0.04em;
`;

export const FundsReadout = styled.span`
  color: var(--color-go-text);
  font-variant-numeric: tabular-nums;
  margin-left: var(--gap-lead-figure);
  /* Keeps the middot with the amount when the subtitle wraps. */
  white-space: nowrap;
`;

export const VesselSwitchPanel = styled.div`
  margin-top: var(--gap-related-compact);
  display: flex;
  flex-direction: column;
  gap: var(--gap-line);
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
  background: var(--color-surface-app);
  padding: var(--inset-switch-panel);
`;

export const VesselSwitchName = styled.span`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

export const VesselSwitchMeta = styled.span`
  font-size: var(--font-size-caption);
  color: currentColor;
  opacity: 0.7;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

export const VesselSwitchDistance = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  margin-right: var(--gap-trailing-figure);
`;

export const VesselSwitchHint = styled.div`
  padding: var(--inset-surface);
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
  line-height: var(--line-height-body);
`;
