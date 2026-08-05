import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { type Severity, severityFromBadgeTone } from "./status/severity";
import { useStatusContribution } from "./status/useStatusContribution";

/**
 * @deprecated Use `severity`. Kept as a fold alias through the migration window,
 * then removed by the styleguide ratchet. `neutral` has no severity and stays a
 * decorative grey chip; the rest fold through `severityFromBadgeTone`.
 */
export type BadgeTone = "neutral" | "go" | "nogo" | "warn" | "info";
export type BadgeSize = "sm" | "md";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * Canonical severity. Drives colour and, when it contributes, its rank. Omit
   * for a purely decorative badge (a kind tag, a count), which renders a neutral
   * grey chip and never moves a panel summary.
   */
  severity?: Severity;
  /** @deprecated Use `severity`. Folds through `severityFromBadgeTone`. */
  tone?: BadgeTone;
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
  tone,
  size = "md",
  live = false,
  report,
  children,
  ...rest
}: BadgeProps) {
  // `neutral` tone (and no tone at all) is decorative: render grey, no severity.
  // Every other tone folds onto the scale, so an un-migrated `tone=` caller
  // renders exactly as before.
  const resolvedSeverity: Severity | undefined =
    severity ??
    (tone !== undefined && tone !== "neutral"
      ? severityFromBadgeTone(tone)
      : undefined);

  const reportLabel =
    report?.label ?? (typeof children === "string" ? children : "");
  useStatusContribution(
    report
      ? {
          id: report.id,
          // A reporting badge with no severity sits at the floor.
          severity: resolvedSeverity ?? "nominal",
          label: reportLabel,
        }
      : null,
  );

  const liveAttrs = live
    ? ({ role: "status", "aria-live": "polite" } as const)
    : {};

  return (
    <Badge__Body
      $severity={resolvedSeverity}
      $size={size}
      {...liveAttrs}
      {...rest}
    >
      {children}
    </Badge__Body>
  );
}

/**
 * Decorative grey: a kind-chip or count with no severity. Distinct from
 * `offline`, which is a dimmer grey carrying a real "data absent" reading.
 */
const DECORATIVE_STYLE = css`
  background: var(--color-surface-raised);
  border-color: var(--color-border-subtle);
  color: var(--color-text-muted);
`;

const SEVERITY_STYLES: Record<Severity, ReturnType<typeof css>> = {
  nominal: css`
    background: var(--color-status-go-bg);
    border-color: var(--color-status-go-bg);
    color: var(--color-status-go-fg);
  `,
  info: css`
    background: var(--color-status-info-bg);
    border-color: var(--color-status-info-bg);
    color: var(--color-status-info-fg);
  `,
  caution: css`
    background: var(--color-status-warning-bg-muted);
    border-color: var(--color-status-warning-border-muted);
    color: var(--color-status-warning-fg-muted);
  `,
  warning: css`
    background: var(--color-status-warning-bg);
    border-color: var(--color-status-warning-bg);
    color: var(--color-status-warning-fg);
  `,
  critical: css`
    background: var(--color-status-nogo-bg);
    border-color: var(--color-status-nogo-bg);
    color: var(--color-status-nogo-on-bg);
  `,
  // Data gone: a dim, hollow grey, deliberately quieter than a red critical and
  // dimmer than a decorative chip, so "disconnected" reads as faded rather than
  // alarming.
  offline: css`
    background: var(--color-surface-raised);
    border-color: var(--color-border-subtle);
    color: var(--color-text-dim);
  `,
};

const SIZE_STYLES = {
  sm: css`
    font-size: var(--font-size-2xs, 10px);
    padding: var(--space-hair, 1px) var(--space-4, 4px);
  `,
  md: css`
    font-size: var(--font-size-xs);
    padding: var(--space-hair, 1px) var(--space-6, 6px);
  `,
} as const;

const Badge__Body = styled.span<{
  $severity: Severity | undefined;
  $size: BadgeSize;
}>`
  display: inline-block;
  border: 1px solid;
  border-radius: var(--radius-sm, 3px);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;

  ${({ $size }) => SIZE_STYLES[$size]}
  ${({ $severity }) =>
    $severity === undefined ? DECORATIVE_STYLE : SEVERITY_STYLES[$severity]}
`;
