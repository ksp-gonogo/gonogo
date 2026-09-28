import { PrimaryButton, Stack } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

export const FeasibilityChip = styled.span<{ $ok: boolean }>`
  font-size: var(--font-size-caption);
  font-weight: ${({ $ok }) => ($ok ? 400 : 700)};
  padding: var(--inset-chip);
  border-radius: var(--radius-pill);
  /* The failing state meets 3:1 non-text contrast on the dark ground. */
  background: ${({ $ok }) => ($ok ? "var(--color-go-status)" : "var(--color-nogo-muted)")};
  border: 1px solid ${({ $ok }) => ($ok ? "var(--color-go-status)" : "var(--color-nogo-mark)")};
  color: ${({ $ok }) => ($ok ? "var(--color-go-text)" : "var(--color-nogo-text)")};
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
  background: var(--color-nogo-muted);
  border: 1px solid var(--color-nogo-mark);
  border-radius: var(--radius-regular);
  color: var(--color-nogo-text);
`;

export const FeasibilityBannerTitle = styled.span`
  font-size: var(--font-size-caption);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

export const FeasibilityBannerBody = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-nogo-text);
`;

export const PreviewGrid = styled.dl`
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--gap-readout-row) var(--gap-label-value);
  align-items: baseline;
  margin: 0;
`;

export const Label = styled.dt`
  font-size: var(--font-size-caption);
  color: var(--color-text-faint);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

export const accentColor = {
  ap: "var(--color-warn-mark)",
  pe: "var(--color-tag-blue-fg)",
};

export const PreviewValue = styled.dd<{ $accent?: "ap" | "pe" }>`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap-readout-row) var(--gap-value-tag);
  font-size: var(--font-size-value);
  color: ${({ $accent }) => ($accent ? accentColor[$accent] : "var(--color-text-primary)")};
  letter-spacing: 0.03em;
  margin: 0;
`;

/** Number + unit stay glued together; only the trailing chip may wrap. */
export const ValueNum = styled.span`
  white-space: nowrap;
`;

export const DiagramWrap = styled.div`
  height: 180px;
  flex-shrink: 0;
  display: flex;

  @container (min-width: 460px) {
    flex: 1 1 0;
    min-width: 0;
  }
`;

export const EditGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

export const EditHint = styled.div`
  font-size: var(--font-size-caption);
  color: var(--color-text-dim);
  letter-spacing: 0.04em;
  text-align: right;
`;

export const EditActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: var(--gap-related);
  padding-top: var(--gap-actions);
`;

export const CompactPrimaryButton = styled(PrimaryButton)`
  align-self: auto;
  font-size: var(--font-size-compact);
  /* Not --inset-control: its vertical would make these footer buttons taller than the 22px row controls. */
  padding: var(--inset-form-footer-button);
`;

export const SecondaryButton = styled.button`
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-subtle);
  font-size: var(--font-size-compact);
  padding: var(--inset-form-footer-button);
  border-radius: var(--radius-regular);
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

// forwardedAs, not as: styled-components consumes `as` and would replace Stack outright.
export const PaddedSection = styled(Stack).attrs({
  forwardedAs: "section" as const,
  gap: "related-dense" as const,
})`
  padding-top: var(--gap-planner-section);
`;

export const WaitingPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  padding: var(--inset-surface);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
`;

export const HyperbolicNotice = styled.p`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  margin: 0;
  line-height: var(--line-height-body);
`;
