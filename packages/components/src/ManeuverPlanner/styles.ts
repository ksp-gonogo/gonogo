import styled from "styled-components";

/**
 * Styled bits shared between ManeuverPlanner/index.tsx and its sub-component
 * files (NodeRow, PresetPicker, PresetInput). Single-use styles live
 * alongside their component.
 */

export const FeasibilityChip = styled.span<{ $ok: boolean }>`
  font-size: var(--font-size-caption);
  font-weight: ${({ $ok }) => ($ok ? 400 : 700)};
  padding: var(--inset-chip);
  border-radius: var(--radius-pill);
  /* The failing state meets 3:1 non-text contrast on the dark ground. */
  background: ${({ $ok }) => ($ok ? "var(--color-status-go-bg)" : "var(--color-status-alert-muted)")};
  border: 1px solid ${({ $ok }) => ($ok ? "var(--color-status-go-bg)" : "var(--color-status-nogo-bg)")};
  color: ${({ $ok }) => ($ok ? "var(--color-status-go-fg)" : "var(--color-status-nogo-fg)")};
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

/**
 * Full-width shortfall banner shown when the planned burn exceeds the
 * available ΔV. Rendered with role="alert" so screen readers announce it
 * on the transition from feasible → infeasible.
 */
export const FeasibilityBanner = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  /* Roomier than --inset-surface: the shortfall text is the widest thing in the widget. */
  padding: var(--inset-feasibility-banner);
  background: var(--color-status-alert-muted);
  border: 1px solid var(--color-status-nogo-bg);
  border-radius: var(--radius-regular);
  color: var(--color-status-nogo-fg);
`;

export const FeasibilityBannerTitle = styled.span`
  font-size: var(--font-size-caption);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

export const FeasibilityBannerBody = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-status-nogo-fg);
`;
