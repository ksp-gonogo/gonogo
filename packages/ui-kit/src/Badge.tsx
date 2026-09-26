import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { fitBox } from "./fitBox";
import type { Severity } from "./status/severity";
import { severityDotColor } from "./status/severityDotColor";
import { useStatusContribution } from "./status/useStatusContribution";

export type BadgeSize = "sm" | "md";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * Canonical severity. Drives colour and, when it contributes, its rank. Omit
   * for a purely decorative badge (a kind tag, a count), which renders a neutral
   * grey chip and never moves a panel summary.
   */
  severity?: Severity;
  size?: BadgeSize;
  /**
   * Announce this badge as a screen-reader live region (`role="status"`). Use
   * for state that changes and the operator benefits from being told (a stream
   * going stale, an alarm firing). Decorative badges leave it off so they do not
   * flood the accessibility tree.
   */
  live?: boolean;
  /**
   * When set, this badge auto-registers itself into the nearest
   * `PanelStatusStore` as a contribution `{ id, severity, label }`, so the panel
   * can summarise it. `id` must be stable for the badge's lifetime. `label`
   * defaults to the badge's text content when `children` is a plain string; pass
   * it explicitly otherwise. A floor (`nominal`) badge with `report` still
   * registers but never wins a merge that has anything above the floor.
   */
  report?: { id: string; label?: string };
  children: ReactNode;
}

/**
 * Compact label/state pill speaking the canonical `Severity` scale. This is the
 * kit's one badge: the single vocabulary every widget's state chips map onto,
 * and the renderer the panel summary and `StreamStatusBadge` compose.
 */
export function Badge({
  severity,
  size = "md",
  live = false,
  report,
  children,
  ...rest
}: BadgeProps) {
  const reportLabel =
    report?.label ?? (typeof children === "string" ? children : "");
  useStatusContribution(
    report
      ? {
          id: report.id,
          // A reporting badge with no severity sits at the floor.
          severity: severity ?? "nominal",
          label: reportLabel,
        }
      : null,
  );

  const liveAttrs = live
    ? ({ role: "status", "aria-live": "polite" } as const)
    : {};

  return (
    <Badge__Body $severity={severity} $size={size} {...liveAttrs} {...rest}>
      {children}
    </Badge__Body>
  );
}

/** Decorative grey, solid-filled: a kind-chip or count with no severity. Distinct from `offline`, which is a real "data absent" reading. */
const DECORATIVE_STYLE = css`
  background: var(--color-surface-raised);
  border-color: var(--color-border-subtle);
  color: var(--color-text-muted);
`;

/** `nominal`'s dot colour is a dark fill that fails 3:1 contrast as outline and text on a transparent pill, so it uses the bright go text token. */
function pillColor(severity: Severity): string {
  return severity === "nominal"
    ? "var(--color-accent-fg)"
    : severityDotColor(severity);
}

/**
 * A transparent pill with a coloured outline and text, so a `nominal` badge
 * reads as status rather than as a solid "go" button. The glow scales with
 * severity: none for `nominal` and `offline`, growing from `info` to
 * `critical`.
 */
const SEVERITY_STYLES: Record<Severity, ReturnType<typeof css>> = {
  nominal: css`
    background: transparent;
    border-color: ${pillColor("nominal")};
    color: ${pillColor("nominal")};
  `,
  info: css`
    background: transparent;
    border-color: ${pillColor("info")};
    color: ${pillColor("info")};
    box-shadow: 0 0 4px 0 color-mix(in srgb, ${pillColor("info")} 40%, transparent);
  `,
  caution: css`
    background: transparent;
    border-color: ${pillColor("caution")};
    color: ${pillColor("caution")};
    box-shadow: 0 0 5px 0 color-mix(in srgb, ${pillColor("caution")} 45%, transparent);
  `,
  warning: css`
    background: transparent;
    border-color: ${pillColor("warning")};
    color: ${pillColor("warning")};
    box-shadow: 0 0 6px 1px color-mix(in srgb, ${pillColor("warning")} 55%, transparent);
  `,
  critical: css`
    background: transparent;
    border-color: ${pillColor("critical")};
    color: ${pillColor("critical")};
    box-shadow: 0 0 8px 2px color-mix(in srgb, ${pillColor("critical")} 65%, transparent);
  `,
  // Data gone reads as faded, dimmer than a decorative chip, rather than alarming.
  offline: css`
    background: transparent;
    border-color: ${pillColor("offline")};
    color: ${pillColor("offline")};
  `,
};

const SIZE_STYLES = {
  sm: css`
    font-size: var(--font-size-caption);
    padding: var(--inset-chip);
  `,
  md: css`
    font-size: var(--font-size-compact);
    padding: var(--inset-chip-roomy);
  `,
} as const;

const Badge__Body = styled.span<{
  $severity: Severity | undefined;
  $size: BadgeSize;
}>`
  display: inline-block;
  /* A badge is sized by its own text in every container. As a flex item it
     would otherwise take the default stretch and grow to the tallest sibling,
     which on a wrapped caption turns the pill radius into an ellipse several
     lines tall. */
  align-self: center;
  ${fitBox("badge")}
  border: 1px solid;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;

  /* Sausage-shaped ONLY for a real severity: a decorative kind-chip (no
     severity) keeps the small rounded-rect shape, since it was never the
     thing that read as a live button and the operator's ask was scoped to
     the status/severity pill. */
  border-radius: ${({ $severity }) =>
    $severity === undefined ? "var(--radius-regular)" : "var(--radius-pill)"};

  ${({ $size }) => SIZE_STYLES[$size]}
  ${({ $severity }) =>
    $severity === undefined ? DECORATIVE_STYLE : SEVERITY_STYLES[$severity]}
`;
