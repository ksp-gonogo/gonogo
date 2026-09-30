import type { HTMLAttributes } from "react";
import { BarTrack } from "./BarTrack";
import { type FillQuantity, fillFraction } from "./fillQuantity";
import { speakQuantity } from "./units";

interface ProgressBarCommonProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /**
   * The bar's accessible name (e.g. "Biome coverage, Kerbin"). Required: a
   * progress bar with no name is announced as a bare percentage of nothing.
   */
  ariaLabel: string;
  /**
   * CSS colour for the fill, overriding the default `--color-accent-fg`. For a
   * bar whose progress is itself a threat (a CME closing in), pass a status
   * token such as `var(--color-nogo-mark)`: the default green reads as
   * reassuring.
   */
  fillColor?: string;
}

/**
 * The {@link ProgressBar} props for a percentage already worked out. See
 * {@link ProgressBarProps}.
 *
 * @category Meter
 */
export interface ProgressBarPercentProps extends ProgressBarCommonProps {
  /**
   * Current value, 0 to 100, for a figure the source already derived as a
   * percentage. Clamped into range before rendering; a non-finite value draws
   * nothing. Where both halves are in hand as quantities, pass `quantity`
   * instead.
   */
  value: number;
  quantity?: never;
}

/**
 * The {@link ProgressBar} props for an amount and a capacity. See
 * {@link ProgressBarProps}.
 *
 * @category Meter
 */
export interface ProgressBarQuantityProps<Unit extends string = string>
  extends ProgressBarCommonProps {
  /**
   * The amount and the capacity it fills. The bar derives the fill and the
   * spoken `aria-valuetext` from them.
   *
   * `null`, or a capacity of zero, draws nothing: no track and no
   * `role="progressbar"`. There is no need to check for a missing value
   * first.
   */
  quantity: FillQuantity<Unit> | null;
  value?: never;
}

/**
 * Everything the bar needs, in one of two mutually exclusive spellings: a
 * `quantity` pair the bar divides itself, or a `value` percentage already
 * divided. Passing both is a type error.
 *
 * @category Meter
 */
export type ProgressBarProps<Unit extends string = string> =
  | ProgressBarPercentProps
  | ProgressBarQuantityProps<Unit>;

/**
 * A task's progress toward done, a native `role="progressbar"`, drawn on the
 * same track and fill as {@link Meter}. Reach for {@link Meter} instead when
 * the bar is a level within a range (a tank, a load) rather than work
 * advancing to an end. Handed a `quantity` pair it also speaks both halves
 * ("120 of 400 build points"), not only the percentage.
 *
 * Renders nothing when there is no finite fraction to draw.
 *
 * @category Meter
 */
export function ProgressBar<Unit extends string = string>({
  value,
  quantity,
  ariaLabel,
  fillColor,
  ...rest
}: Readonly<ProgressBarProps<Unit>>) {
  const fraction = quantity === undefined ? null : fillFraction(quantity);

  // Absence, not a zero bar.
  if (quantity !== undefined && fraction === null) return null;
  const percent = fraction === null ? (value ?? Number.NaN) : fraction * 100;
  if (!Number.isFinite(percent)) return null;
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <BarTrack
      percent={clamped}
      tone="neutral"
      fillColor={fillColor ?? "var(--color-accent-fg)"}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={quantity ? bothHalves(quantity) : undefined}
      {...rest}
    />
  );
}

/**
 * The pair, spoken at one rung: both halves are pinned to the capacity's unit,
 * the half that does not move, so 500 kg of a 1 t tank reads "500 kilograms of
 * 1,000 kilograms".
 */
function bothHalves<Unit extends string>(pair: FillQuantity<Unit>): string {
  const said = { format: pair.capacity.unit };
  return `${speakQuantity(pair.amount, said)} of ${speakQuantity(
    pair.capacity,
    said,
  )}`;
}
