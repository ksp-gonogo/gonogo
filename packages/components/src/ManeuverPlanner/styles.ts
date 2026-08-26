import styled from "styled-components";

/**
 * Styled bits shared between ManeuverPlanner/index.tsx and its sub-component
 * files (NodeRow, PresetPicker, PresetInput). Single-use styles live
 * alongside their component.
 */

export const FeasibilityChip = styled.span<{ $ok: boolean }>`
  font-size: var(--font-size-xs);
  font-weight: ${({ $ok }) => ($ok ? 400 : 700)};
  padding: var(--space-hair) var(--space-6);
  /* A stadium, not a corner: --radius-pill rather than a fixed px, so the
     shape survives a change to this chip's padding or font size. */
  border-radius: var(--radius-pill);
  /* Failing state shifted brighter: the quiet maroon on dark background
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
  gap: var(--space-2);
  padding: var(--space-6) var(--space-10);
  background: var(--color-status-alert-muted);
  border: 1px solid var(--color-status-nogo-bg);
  border-radius: var(--radius-xs);
  color: var(--color-status-nogo-fg);
`;

export const FeasibilityBannerTitle = styled.span`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

export const FeasibilityBannerBody = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-status-nogo-fg);
`;
