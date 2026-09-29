import { FitLabelButton, Text } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

export const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
`;

export const PadStatusLine = styled.span`
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
`;

export const AbsenceLine = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.04em;
  color: var(--color-text-faint);
`;

export const FundsReadout = styled.span`
  color: var(--color-go-text);
  font-variant-numeric: tabular-nums;
  margin-left: var(--gap-lead-figure);
`;

export const TinyFunds = styled.div`
  /* Fluid, so off the type scale: the compact value must still fit the 2x3 minimum size. */
  font-size: clamp(12px, 13cqw, 22px);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-go-text);
  line-height: var(--line-height-flush);
  max-width: 100%;
  white-space: nowrap;
`;

export const TinyFundsUnit = styled.span`
  /* Off the type scale: the suffix must not out-size the balance, which is pinned at 12px at the minimum size. */
  font-size: 12px;
  color: var(--color-text-muted);
  margin-left: var(--gap-unit-suffix);
`;

export const TinyPad = styled.span<{ $occupied: boolean }>`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${(p) =>
    p.$occupied ? "var(--color-accent-fg)" : "var(--color-text-faint)"};
`;

export const FacilityGrid = styled.div<{ $compact: boolean }>`
  display: grid;
  grid-template-columns: ${(p) =>
    p.$compact ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))"};
  gap: var(--gap-related);
`;

export const FacilityCell = styled.div`
  display: flex;
  flex-direction: column;
  padding: var(--inset-surface);
  background: var(--color-surface-panel);
  border-radius: var(--radius-regular);
`;

export const FacilityLabel = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  /* Off the line-height scale: the min-height below is two of these lines, so the two move together. */
  line-height: 1.3;
  /* Every cell reserves two label lines, so the tier, cost and button line up across a row. */
  display: block;
  min-height: 2.6em;
`;

export const FacilityValue = styled.span`
  font-size: var(--font-size-value);
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
`;

export const Tier = styled.span`
  color: var(--color-accent-fg);
`;

export const Slash = styled.span`
  color: var(--color-text-faint);
  margin: 0 var(--gap-lead-figure);
`;

export const TierMax = styled.span`
  color: var(--color-text-muted);
`;

export const Muted = styled.span`
  color: var(--color-text-faint);
`;

export const UpgradeRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-related);
  margin-top: var(--gap-actions);
  flex-wrap: wrap;
`;

export const UpgradeCost = styled.span<{ $afford: boolean }>`
  font-size: var(--font-size-compact);
  /* The nogo bg token, not fg: fg is meant for the red fill and reads as ordinary copy on the dark cell. */
  color: ${(p) =>
    p.$afford ? "var(--color-accent-fg)" : "var(--color-nogo-mark)"};
  font-weight: ${(p) => (p.$afford ? "inherit" : "600")};
  font-variant-numeric: tabular-nums;
`;

export const MaxBadge = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
  text-transform: uppercase;
  margin-top: var(--gap-caption);
`;

export const TierSpecs = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  margin-top: var(--gap-related-compact);
  padding-top: var(--inset-below-rule);
  border-top: 1px dashed var(--color-border-subtle);
`;

export const TierBlock__Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const TierBlock__Heading = styled.span`
  font-size: var(--font-size-caption);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

export const TierBlock__Absent = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
`;

// Wraps rather than ellipsising: a cell is under 100px wide at the default size.
export const TierBlock__Label = styled.span`
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
`;

// Breaking inside "Unlimited" beats spilling onto the facility beside it.
export const TierBlock__Value = styled(Text)`
  min-width: 0;
  overflow-wrap: anywhere;
`;

export const TIER_SPEC_LIST = {
  listStyle: "none",
  margin: 0,
  padding: 0,
} as const;

export const UpgradeButtonStyled = styled(FitLabelButton)`
  font-size: var(--font-size-compact);
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: var(--inset-control);
  border-radius: var(--radius-regular);
  border: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-family: inherit;
  text-align: center;
  /* Must shrink below its label so FitLabelButton can measure it and fall back to the icon. */
  min-width: 0;

  &:hover:not(:disabled):not([aria-disabled="true"]) {
    color: var(--color-accent-fg);
    border-color: var(--color-accent-fg);
  }

  /* A blocked control keeps its focus ring and answers a press with its reason, hence aria-disabled. */
  &:disabled,
  &[aria-disabled="true"] {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

export const ConfirmUpgradeButton = styled(UpgradeButtonStyled)`
  background: var(--color-go-status);
  color: var(--color-go-on-status);
  border-color: transparent;
  /* The animation lives inside the same reduced-motion guard as its keyframes. */
  @media (prefers-reduced-motion: no-preference) {
    /* An attention pulse, not a UI transition, so off the duration scale. */
    animation: upgradePulse 1s var(--ease-emphasis) infinite;
    @keyframes upgradePulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.6;
      }
    }
  }
`;
