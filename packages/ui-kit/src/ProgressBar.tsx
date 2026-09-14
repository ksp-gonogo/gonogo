import type { HTMLAttributes } from "react";
import styled from "styled-components";
import { type FillQuantity, fillFraction } from "./fillQuantity";
import { speakQuantity } from "./units";

interface ProgressBarCommonProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Accessible label for screen readers (e.g. "Biome coverage, Kerbin"). */
  ariaLabel?: string;
  /**
   * CSS colour for the fill, overriding the default `--color-accent-fg`.
   * For a bar whose progress is itself a threat (a CME closing in, not a
   * coverage percentage getting better), the default green reads as
   * reassuring; pass a status token here instead (e.g.
   * `var(--color-status-nogo-bg)`) so "further along" doesn't visually mean
   * "more done".
   */
  fillColor?: string;
}

/** The bar driven by a percentage already worked out. See {@link ProgressBarProps}. */
export interface ProgressBarPercentProps extends ProgressBarCommonProps {
  /**
   * Current value, 0–100. Clamped into range before rendering; non-finite
   * renders empty.
   *
   * For a figure that is genuinely a percentage where it is read: one the
   * source already derived and whose two halves never reach this call site,
   * such as RP-1's own `progressRatio`. Where both halves ARE in hand as
   * quantities, pass `quantity` instead and let the bar divide them, so
   * nothing has to take on faith that they were the same kind.
   */
  value: number;
  quantity?: never;
}

/** The bar driven by an amount and a capacity. See {@link ProgressBarProps}. */
export interface ProgressBarQuantityProps<U extends string = string>
  extends ProgressBarCommonProps {
  /**
   * The amount and the capacity it fills. The bar derives the fill AND the
   * spoken `aria-valuetext` from them, so neither the division nor the
   * "120 of 400" string is written at the call site.
   *
   * `null` draws NOTHING: no track, no `role="progressbar"`. That is the
   * point. A progress bar asserts a fraction and an `aria-valuenow` to go
   * with it, and there is no fraction to assert; an empty six-pixel track is
   * indistinguishable from a 0% one, so drawing it would tell the operator
   * the work has not started rather than that nobody said. A capacity of zero
   * draws nothing for the same reason, since that is no tank rather than an
   * empty one. A call site handing over the pair therefore needs no gate of
   * its own.
   */
  quantity: FillQuantity<U> | null;
  value?: never;
}

/**
 * Everything the bar needs, in one of two mutually exclusive spellings: a
 * `quantity` pair the bar divides itself, or a `value` percentage already
 * divided. Passing both is a type error, which is the point of the split.
 */
export type ProgressBarProps<U extends string = string> =
  | ProgressBarPercentProps
  | ProgressBarQuantityProps<U>;

/**
 * Thin track+fill progress indicator. Extracted from the Scanning widget's
 * coverage bar (`CoverageBar`/`CoverageFill`): the same shape covers the
 * ContractManager altitude-envelope bar. Renders as a native
 * `role="progressbar"` so screen readers announce the percentage.
 *
 * Handed a `quantity` pair it also speaks both halves, because a bare
 * percentage is the one reading this primitive draws and a track six pixels
 * high is not a figure. "30%" and "120 of 400 build points" are different
 * amounts of help, and the second costs a call site nothing once it is
 * handing over the pair it already holds.
 */
export function ProgressBar<U extends string = string>({
  value,
  quantity,
  ariaLabel,
  fillColor,
  ...rest
}: Readonly<ProgressBarProps<U>>) {
  const fraction = quantity === undefined ? null : fillFraction(quantity);

  // Absence, not a zero bar. Only the pair spelling can be absent: a caller
  // holding a percentage already has a number, and the call sites that cannot
  // read one gate the whole bar away themselves.
  if (quantity !== undefined && fraction === null) return null;

  const percent = fraction === null ? (value ?? Number.NaN) : fraction * 100;
  const clamped = Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent))
    : 0;

  return (
    <ProgressBar__Track
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={quantity ? bothHalves(quantity) : undefined}
      {...rest}
    >
      <ProgressBar__Fill $percent={clamped} $fillColor={fillColor} />
    </ProgressBar__Track>
  );
}

/**
 * The pair, spoken, at ONE rung.
 *
 * Both halves are pinned to the CAPACITY's unit, so 500 kg of a 1 t tank reads
 * "500 kilograms of 1,000 kilograms" rather than putting its two halves in two
 * different units and leaving the listener to do the conversion. The capacity
 * rather than the amount because the capacity is the axis: it is the half that
 * does not move, so the rung does not either.
 *
 * `aria-valuetext` is an attribute and can only hold a string, which is why
 * this writes its own figure through `speakQuantity` rather than drawing a
 * `<Unit>`. The pinned format is what makes that the same ladder `<Unit>`
 * would have used.
 */
function bothHalves<U extends string>(pair: FillQuantity<U>): string {
  const said = { format: pair.capacity.unit };
  return `${speakQuantity(pair.amount, said)} of ${speakQuantity(
    pair.capacity,
    said,
  )}`;
}

const ProgressBar__Track = styled.div`
  height: 6px;
  background: var(--color-surface-raised);
  /* Stadium, not a corner: a fixed radius sized to half this 6px height
     decouples the corner from the track the moment the height changes.
     --radius-pill clamps to the same shape and survives it. */
  border-radius: var(--radius-pill, 999px);
  overflow: hidden;
`;

const ProgressBar__Fill = styled.div<{ $percent: number; $fillColor?: string }>`
  height: 100%;
  width: ${({ $percent }) => `${$percent}%`};
  background: ${({ $fillColor }) => $fillColor ?? "var(--color-accent-fg)"};
  /* Off the motion scale on purpose: a determinate fill has to advance at a
     constant rate, so both the 250ms and the linear timing carry meaning
     rather than taste. The motion tokens cover UI transitions only. */
  transition: width 250ms linear;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;
