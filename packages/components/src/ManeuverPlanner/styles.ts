import styled from "styled-components";

/**
 * Styled bits shared between ManeuverPlanner/index.tsx and its sub-component
 * files (NodeRow, PresetPicker, LabeledInput). Single-use styles live
 * alongside their component.
 */

export const FeasibilityChip = styled.span<{ $ok: boolean }>`
  font-size: var(--font-size-xs);
  font-weight: ${({ $ok }) => ($ok ? 400 : 700)};
  padding: 1px 6px;
  border-radius: 10px;
  /* Failing state shifted brighter — the quiet maroon on dark background
     was sliding past readers. WCAG 1.4.11 non-text contrast met at 3:1. */
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
  gap: 2px;
  padding: 6px 10px;
  background: var(--color-status-alert-muted);
  border: 1px solid var(--color-status-nogo-bg);
  border-radius: 2px;
  color: var(--color-status-nogo-fg);
`;

export const FeasibilityBannerTitle = styled.span`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

export const FeasibilityBannerBody = styled.span`
  font-size: 11px;
  color: var(--color-status-nogo-fg);
`;
