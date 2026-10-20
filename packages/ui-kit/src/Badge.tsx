import type { HeldGrade, Reading, Tone } from "@ksp-gonogo/sitrep-sdk";
import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { fitBox } from "./fitBox";
import { heldTone } from "./heldTone";
import { heldGradeOf } from "./readingCurrency";
import { RECKONING_MARK } from "./reckoningMarkSpec";
import type { Severity } from "./status/severity";
import { heldWord } from "./status/streamStatusWord";
import { useStatusContribution } from "./status/useStatusContribution";
import { useTooltip } from "./Tooltip";
import { TONE_MARK, TONE_TEXT } from "./tone";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * Badge text size: `sm` for dense rows and table cells, `md` (the default)
 * elsewhere. Set with the `size` prop of {@link Badge}.
 * Useful for fitting a badge into a dense table row or a roomier header.
 *
 * @category Badge
 */
export type BadgeSize = "sm" | "md";

/**
 * Props for {@link Badge}: the label, its tone and its size. Any other `span`
 * attribute (`title`, `aria-label`) passes through to the pill.
 * Useful for labelling a state or a count in a tone the operator reads at a
 * glance. Used by {@link Badge}.
 *
 * @category Badge
 */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * The state the badge shows. Sets its colour and, with `report`, where it
   * ranks in the panel's summary. Omit it, or pass `neutral`, for a purely
   * decorative badge (a kind tag, a count), which renders a grey chip and never
   * moves a panel summary.
   */
  tone?: Tone;
  /** Text size, `sm` or `md`. Absent, `md`. */
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
   * it explicitly otherwise. A `go` badge with `report` still registers, but
   * any worse state in the panel wins the summary over it. Outside a panel
   * there is no store to register into, so `report` does nothing and the badge
   * draws as usual.
   */
  report?: { id: string; label?: string };
  /**
   * The reading the badge's state comes from, or that reading's held grade.
   * While it is held the badge keeps its words, takes its held tone (`go` and
   * `info` read `caution`, every other tone is kept) and carries the held
   * square on its top right corner; its panel summary takes the same tone. The
   * grade's word is spoken after the badge's words and shown on hover; a
   * caller that wraps a held badge in its own {@link Tooltip} names the grade
   * in that tooltip's text. A current reading, or none, changes nothing.
   */
  held?: HeldGrade | Reading<unknown>;
  /** The badge's words, drawn uppercase. */
  children: ReactNode;
}

/**
 * A compact uppercase pill that shows a label in one `Tone`. Useful for telling
 * the operator the state of a part, vessel or connection at a glance, or for
 * tagging a kind or a count. Used by the panel's summary badge and
 * {@link StreamStatusBadge}.
 *
 * A stateful tone (`info`, `go`, `caution`, `warn`, `nogo` or `offline`; `Tone`
 * has the full set and `Button` takes a narrower one) draws an outlined pill in
 * that tone's colour, with a glow that grows with severity. No tone, or
 * `neutral`, draws a grey rounded chip for a kind tag or a count.
 *
 * @example
 * ```tsx
 * <Badge tone="warn" live report={{ id: "fuel-low" }}>
 *   Fuel low
 * </Badge>
 * ```
 *
 * @category Badge
 * @categoryDescription Badge
 * Small marks that name a state: a badge in a tone, a status dot, and the
 * stream's connection status in words.
 */
export function Badge({
  tone: ownTone,
  size = "md",
  live = false,
  report,
  held,
  children,
  ...rest
}: BadgeProps) {
  const grade = heldGradeOf(held);
  const tone = grade === undefined ? ownTone : heldTone(ownTone);
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
  const heldCaption = grade === undefined ? null : heldWord(grade);
  // A caller's Tooltip around the badge owns the hover, and must name the grade itself.
  const wrapped = Reflect.get(rest, "data-tooltip") !== undefined;
  const { anchor, tip } = useTooltip(wrapped ? null : heldCaption);

  return (
    <>
      <Badge__Body
        $severity={severity}
        $size={size}
        {...liveAttrs}
        {...anchor}
        {...rest}
      >
        {children}
        {heldCaption !== null && (
          <>
            <Badge__HeldMark aria-hidden="true" data-held-mark="" />
            <VisuallyHidden data-unit-currency="">
              , {heldCaption}
            </VisuallyHidden>
          </>
        )}
      </Badge__Body>
      {tip}
    </>
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
  position: relative;
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

/** The held square, centred on the badge's top right corner so it sits on the border rather than among the words. */
const Badge__HeldMark = styled.span`
  position: absolute;
  top: 0;
  right: 0;
  width: ${RECKONING_MARK.held.domSize};
  height: ${RECKONING_MARK.held.domSize};
  transform: translate(45%, -45%);
  background: ${RECKONING_MARK.held.color};
  box-shadow: 0 0 0 1px var(--color-surface-panel);
  pointer-events: none;
`;
