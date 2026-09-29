import { Button, ContainerBreak } from "@ksp-gonogo/ui-kit";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
} from "react";

export function FeasibilityChip({
  $ok,
  children,
}: Readonly<{ $ok: boolean; children?: ReactNode }>) {
  return (
    <span style={$ok ? FEASIBILITY_CHIP_OK : FEASIBILITY_CHIP_FAIL}>
      {children}
    </span>
  );
}

const FEASIBILITY_CHIP_BASE: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  padding: "var(--inset-chip)",
  borderRadius: "var(--radius-pill)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

// The failing state meets 3:1 non-text contrast on the dark ground.
const FEASIBILITY_CHIP_OK: CSSProperties = {
  ...FEASIBILITY_CHIP_BASE,
  fontWeight: 400,
  background: "var(--color-go-status)",
  border: "1px solid var(--color-go-status)",
  color: "var(--color-go-text)",
};

const FEASIBILITY_CHIP_FAIL: CSSProperties = {
  ...FEASIBILITY_CHIP_BASE,
  fontWeight: 700,
  background: "var(--color-nogo-muted)",
  border: "1px solid var(--color-nogo-mark)",
  color: "var(--color-nogo-text)",
};

/**
 * Full-width shortfall banner shown when the planned burn exceeds the
 * available ΔV. Rendered with role="alert" so screen readers announce it
 * on the transition from feasible → infeasible.
 */
export function FeasibilityBanner({
  children,
  ...rest
}: Readonly<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div style={FEASIBILITY_BANNER_STYLE} {...rest}>
      {children}
    </div>
  );
}

const FEASIBILITY_BANNER_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  // Roomier than --inset-surface: the shortfall text is the widest thing in the widget.
  padding: "var(--inset-feasibility-banner)",
  background: "var(--color-nogo-muted)",
  border: "1px solid var(--color-nogo-mark)",
  borderRadius: "var(--radius-regular)",
  color: "var(--color-nogo-text)",
};

export function FeasibilityBannerTitle({
  children,
}: Readonly<{ children?: ReactNode }>) {
  return <span style={FEASIBILITY_BANNER_TITLE_STYLE}>{children}</span>;
}

const FEASIBILITY_BANNER_TITLE_STYLE: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
};

export function FeasibilityBannerBody({
  children,
}: Readonly<{ children?: ReactNode }>) {
  return <span style={FEASIBILITY_BANNER_BODY_STYLE}>{children}</span>;
}

const FEASIBILITY_BANNER_BODY_STYLE: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-nogo-text)",
};

export function PreviewGrid({ children }: Readonly<{ children?: ReactNode }>) {
  return <dl style={PREVIEW_GRID_STYLE}>{children}</dl>;
}

const PREVIEW_GRID_STYLE: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "max-content 1fr",
  gap: "var(--gap-readout-row) var(--gap-label-value)",
  alignItems: "baseline",
  margin: 0,
};

export function Label({ children }: Readonly<{ children?: ReactNode }>) {
  return <dt style={LABEL_STYLE}>{children}</dt>;
}

const LABEL_STYLE: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-faint)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

export const accentColor = {
  ap: "var(--color-warn-mark)",
  pe: "var(--color-tag-blue-fg)",
};

export function PreviewValue({
  $accent,
  children,
  ...rest
}: Readonly<
  HTMLAttributes<HTMLElement> & { $accent?: "ap" | "pe"; children?: ReactNode }
>) {
  return (
    <dd
      style={{
        ...PREVIEW_VALUE_STYLE,
        color: $accent ? accentColor[$accent] : "var(--color-text-primary)",
      }}
      {...rest}
    >
      {children}
    </dd>
  );
}

const PREVIEW_VALUE_STYLE: CSSProperties = {
  display: "inline-flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--gap-readout-row) var(--gap-value-tag)",
  fontSize: "var(--font-size-value)",
  letterSpacing: "0.03em",
  margin: 0,
};

/** Number + unit stay glued together; only the trailing chip may wrap. */
export function ValueNum({ children }: Readonly<{ children?: ReactNode }>) {
  return <span style={VALUE_NUM_STYLE}>{children}</span>;
}

const VALUE_NUM_STYLE: CSSProperties = { whiteSpace: "nowrap" };

const DIAGRAM_WRAP_NARROW: CSSProperties = {
  height: "180px",
  flexShrink: 0,
  display: "flex",
};

const DIAGRAM_WRAP_WIDE: CSSProperties = { flex: "1 1 0", minWidth: 0 };

export function DiagramWrap({ children }: Readonly<{ children?: ReactNode }>) {
  return (
    <ContainerBreak
      at={460}
      narrow={DIAGRAM_WRAP_NARROW}
      wide={DIAGRAM_WRAP_WIDE}
    >
      {children}
    </ContainerBreak>
  );
}

export function EditGrid({ children }: Readonly<{ children?: ReactNode }>) {
  return <div style={EDIT_GRID_STYLE}>{children}</div>;
}

const EDIT_GRID_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
};

export function EditHint({ children }: Readonly<{ children?: ReactNode }>) {
  return <div style={EDIT_HINT_STYLE}>{children}</div>;
}

const EDIT_HINT_STYLE: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-dim)",
  letterSpacing: "0.04em",
  textAlign: "right",
};

export function EditActions({ children }: Readonly<{ children?: ReactNode }>) {
  return <div style={EDIT_ACTIONS_STYLE}>{children}</div>;
}

const EDIT_ACTIONS_STYLE: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "var(--gap-related)",
  paddingTop: "var(--gap-actions)",
};

const COMPACT_BUTTON_STYLE: CSSProperties = {
  alignSelf: "auto",
  fontSize: "var(--font-size-compact)",
  // Not --inset-control: its vertical would make these footer buttons taller than the 22px row controls.
  padding: "var(--inset-form-footer-button)",
};

export function CompactPrimaryButton(
  props: Readonly<ButtonHTMLAttributes<HTMLButtonElement>>,
) {
  return <Button variant="primary" style={COMPACT_BUTTON_STYLE} {...props} />;
}

export function SecondaryButton(
  props: Readonly<ButtonHTMLAttributes<HTMLButtonElement>>,
) {
  return <Button variant="ghost" style={COMPACT_BUTTON_STYLE} {...props} />;
}

export function PaddedSection({
  children,
}: Readonly<{ children?: ReactNode }>) {
  return <section style={PADDED_SECTION_STYLE}>{children}</section>;
}

const PADDED_SECTION_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related-dense)",
  paddingTop: "var(--gap-planner-section)",
};

export function WaitingPanel({ children }: Readonly<{ children?: ReactNode }>) {
  return <div style={WAITING_PANEL_STYLE}>{children}</div>;
}

const WAITING_PANEL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  padding: "var(--inset-surface)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-regular)",
};

export function HyperbolicNotice({
  children,
}: Readonly<{ children?: ReactNode }>) {
  return <p style={HYPERBOLIC_NOTICE_STYLE}>{children}</p>;
}

const HYPERBOLIC_NOTICE_STYLE: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-muted)",
  margin: 0,
  lineHeight: "var(--line-height-body)",
};
