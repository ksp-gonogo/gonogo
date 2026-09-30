import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { fitBox } from "./fitBox";
import type { Severity } from "./status/severity";
import { useStatusContribution } from "./status/useStatusContribution";
import { TONE_MARK, TONE_TEXT } from "./tone";

/**
 * Badge text size: `sm` for dense rows and table cells, `md` (the default) elsewhere.
 *
 * @category Badge
 */
export type BadgeSize = "sm" | "md";

/**
 * Props for {@link Badge}. Any other `span` attribute (`title`, `aria-label`) passes through to the pill.
 *
 * @category Badge
 */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * The state the badge shows. Drives colour and, when it contributes, its
   * rank. Omit it, or pass `neutral`, for a purely decorative badge (a kind
   * tag, a count), which renders a grey chip and never moves a panel summary.
   */
  tone?: Tone;
  size?: BadgeSize;
  /**
   * Announce this badge as a screen-reader live region (`role="status"`). Use
   * for state that changes and the operator benefits from being told (a stream
   * going held, an alarm firing). Decorative badges leave it off so they do not
   * flood the accessibility tree.
   */
  live?: boolean;
  /**
   * When set, this badge registers itself into the nearest
   * {@link PanelStatusStore} as a contribution `{ id, severity, label }`, so the panel
   * can summarise it. `id` must be stable for the badge's lifetime. `label`
   * defaults to the badge's text content when `children` is a plain string; pass
   * it explicitly otherwise. A floor (`go`) badge with `report` still
   * registers but never wins a merge that has anything above the floor.
   */
  report?: { id: string; label?: string };
  children: ReactNode;
}

/**
 * A compact uppercase pill that shows a label in one `Tone`. A stateful tone
 * (`go` through `nogo`, and `offline`) draws an outlined pill in that tone's
 * colour, with a glow that grows with severity; no tone, or `neutral`, draws
 * a grey rounded chip for a kind tag or a count. The panel's summary badge and
 * {@link StreamStatusBadge} are both drawn with it.
 *
 * @example
 * ```tsx
 * <Badge tone="warn" live report={{ id: "fuel-low" }}>
 *   Fuel low
 * </Badge>
 * ```
 *
 * @category Badge
 */
export function Badge({
  tone,
  size = "md",
  live = false,
  report,
  children,
  ...rest
}: BadgeProps) {
  const severity: Severity | undefined =
    tone === undefined || tone === "neutral" ? undefined : tone;
  const reportLabel =
    report?.label ?? (typeof children === "string" ? children : "");
  useStatusContribution(
    report
      ? {
          id: report.id,
          // A reporting badge with no state sits at the floor.
          severity: severity ?? "go",
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

/** Decorative grey, solid-filled: a kind-chip or count with no state. Distinct from `offline`, which is a real "data absent" reading. */
const DECORATIVE_STYLE = css`
  background: var(--color-surface-raised);
  border-color: var(--color-border-subtle);
  color: var(--color-text-muted);
`;

/**
 * A transparent pill with the tone's mark as its outline and its text as the
 * label, so a `go` badge reads as status rather than as a solid "go" button.
 * The glow scales with severity: none for `go` and `offline`, growing from
 * `info` to `nogo`.
 */
const SEVERITY_STYLES: Record<Severity, ReturnType<typeof css>> = {
  go: css`
    background: transparent;
    border-color: ${TONE_MARK.go};
    color: ${TONE_TEXT.go};
  `,
  info: css`
    background: transparent;
    border-color: ${TONE_MARK.info};
    color: ${TONE_TEXT.info};
    box-shadow: 0 0 4px 0 color-mix(in srgb, ${TONE_MARK.info} 40%, transparent);
  `,
  caution: css`
    background: transparent;
    border-color: ${TONE_MARK.caution};
    color: ${TONE_TEXT.caution};
    box-shadow: 0 0 5px 0 color-mix(in srgb, ${TONE_MARK.caution} 45%, transparent);
  `,
  warn: css`
    background: transparent;
    border-color: ${TONE_MARK.warn};
    color: ${TONE_TEXT.warn};
    box-shadow: 0 0 6px 1px color-mix(in srgb, ${TONE_MARK.warn} 55%, transparent);
  `,
  nogo: css`
    background: transparent;
    border-color: ${TONE_MARK.nogo};
    color: ${TONE_TEXT.nogo};
    box-shadow: 0 0 8px 2px color-mix(in srgb, ${TONE_MARK.nogo} 65%, transparent);
  `,
  // Data gone reads as faded, dimmer than a decorative chip, rather than alarming.
  offline: css`
    background: transparent;
    border-color: ${TONE_MARK.offline};
    color: ${TONE_TEXT.offline};
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
  /* Sized by its own text, never stretched to a taller flex sibling. */
  align-self: center;
  ${fitBox("badge")}
  border: 1px solid;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;

  /* Pill-shaped only for a real severity; a decorative kind chip keeps the rounded rect. */
  border-radius: ${({ $severity }) =>
    $severity === undefined ? "var(--radius-regular)" : "var(--radius-pill)"};

  ${({ $size }) => SIZE_STYLES[$size]}
  ${({ $severity }) =>
    $severity === undefined ? DECORATIVE_STYLE : SEVERITY_STYLES[$severity]}
`;
