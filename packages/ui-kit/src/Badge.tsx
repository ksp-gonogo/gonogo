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
   *
   * Contribution is opt-in, so a widget full of neutral kind-chips does not
   * drown its own real status.
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

/**
 * Decorative grey: a kind-chip or count with no severity. Distinct from
 * `offline`, which is a dimmer grey carrying a real "data absent" reading.
 * Unaffected by the sausage restyle below: a decorative chip was never the
 * thing that read as a live button, so it keeps its solid fill.
 */
const DECORATIVE_STYLE = css`
  background: var(--color-surface-raised);
  border-color: var(--color-border-subtle);
  color: var(--color-text-muted);
`;

/**
 * The pill's outline/text/glow colour for each severity. Reads off
 * `severityDotColor`, the one function every other per-severity accent
 * already goes through, with a single deliberate exception: `nominal`'s dot
 * colour (`--color-status-go-bg`) is a DARK fill tuned for a small dot or a
 * button's solid background (2.4:1 against the panel, under the 3:1
 * non-text floor), so painting it directly as this pill's outline/text would
 * fail contrast on the pill's transparent background. `--color-accent-fg` is
 * the bright "go" text token PrimaryButton itself already uses and clears
 * the floor with room to spare.
 */
function pillColor(severity: Severity): string {
  return severity === "nominal"
    ? "var(--color-accent-fg)"
    : severityDotColor(severity);
}

/**
 * Sausage-shaped severity pill: transparent background, a coloured outline,
 * and coloured text, restoring the look from before the solid-fill
 * consolidation (see `bd7ff353^` for the pre-refactor version). The solid
 * fill made a `nominal` badge read as indistinguishable from a live "go"
 * button, since both painted the exact same `--color-status-go-bg` chip; a
 * transparent pill with only its outline and text lit up reads as status,
 * not as a control.
 *
 * The glow (`box-shadow`) scales with severity: `nominal`/`offline` carry
 * none at all (a healthy or data-absent pill has nothing to shout about),
 * `info`/`caution` get a soft bloom, and `warning`/`critical` get a
 * progressively stronger one, so the AMOUNT a badge glows is itself a
 * severity signal at a glance, before the label is even read. Kept
 * deliberately soft ("slight glow", not a neon sign): a static box-shadow
 * needs no `prefers-reduced-motion` guard, it never animates.
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
  // Data gone: a dim, hollow grey with no glow, deliberately quieter than a
  // red critical and dimmer than a decorative chip, so "disconnected" reads
  // as faded rather than alarming.
  offline: css`
    background: transparent;
    border-color: ${pillColor("offline")};
    color: ${pillColor("offline")};
  `,
};

const SIZE_STYLES = {
  sm: css`
    font-size: var(--font-size-2xs, 10px);
    padding: var(--space-hair, 1px) var(--space-6, 6px);
  `,
  md: css`
    font-size: var(--font-size-xs);
    padding: var(--space-hair, 1px) var(--space-8, 8px);
  `,
} as const;

const Badge__Body = styled.span<{
  $severity: Severity | undefined;
  $size: BadgeSize;
}>`
  display: inline-block;
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
    $severity === undefined
      ? "var(--radius-sm, 3px)"
      : "var(--radius-pill, 999px)"};

  ${({ $size }) => SIZE_STYLES[$size]}
  ${({ $severity }) =>
    $severity === undefined ? DECORATIVE_STYLE : SEVERITY_STYLES[$severity]}
`;
