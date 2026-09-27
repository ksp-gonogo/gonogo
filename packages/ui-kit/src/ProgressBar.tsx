import type { HTMLAttributes } from "react";
import styled from "styled-components";
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
   * token such as `var(--color-status-nogo-bg)`, since the default green reads
   * as reassuring.
   */
  fillColor?: string;
}

/** The bar driven by a percentage already worked out. See {@link ProgressBarProps}. */
export interface ProgressBarPercentProps extends ProgressBarCommonProps {
  /**
   * Current value, 0-100. Clamped into range before rendering; a non-finite
   * value draws nothing, since an empty track would read as 0%. For a figure the source already derived as a percentage;
   * where both halves are in hand as quantities, pass `quantity` instead.
   */
  value: number;
  quantity?: never;
}

/** The bar driven by an amount and a capacity. See {@link ProgressBarProps}. */
export interface ProgressBarQuantityProps<U extends string = string>
  extends ProgressBarCommonProps {
  /**
   * The amount and the capacity it fills. The bar derives the fill and the
   * spoken `aria-valuetext` from them.
   *
   * `null`, or a capacity of zero, draws nothing: no track and no
   * `role="progressbar"`, since an empty track is indistinguishable from 0%. A
   * call site needs no absence gate of its own.
   */
  quantity: FillQuantity<U> | null;
  value?: never;
}

/**
 * Everything the bar needs, in one of two mutually exclusive spellings: a
 * `quantity` pair the bar divides itself, or a `value` percentage already
 * divided. Passing both is a type error.
 */
export type ProgressBarProps<U extends string = string> =
  | ProgressBarPercentProps
  | ProgressBarQuantityProps<U>;

/**
 * Thin track and fill progress indicator, a native `role="progressbar"`.
 * Handed a `quantity` pair it also speaks both halves ("120 of 400 build
 * points"), not only the percentage.
 */
export function ProgressBar<U extends string = string>({
  value,
  quantity,
  ariaLabel,
  fillColor,
  ...rest
}: Readonly<ProgressBarProps<U>>) {
  const fraction = quantity === undefined ? null : fillFraction(quantity);

  // Absence, not a zero bar.
  if (quantity !== undefined && fraction === null) return null;
  const percent = fraction === null ? (value ?? Number.NaN) : fraction * 100;
  if (!Number.isFinite(percent)) return null;
  const clamped = Math.max(0, Math.min(100, percent));

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
 * The pair, spoken at one rung: both halves are pinned to the capacity's unit,
 * the half that does not move, so 500 kg of a 1 t tank reads "500 kilograms of
 * 1,000 kilograms".
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
  /* --radius-pill keeps the stadium shape through a height change. */
  border-radius: var(--radius-pill);
  overflow: hidden;
`;

const ProgressBar__Fill = styled.div<{ $percent: number; $fillColor?: string }>`
  height: 100%;
  width: ${({ $percent }) => `${$percent}%`};
  background: ${({ $fillColor }) => $fillColor ?? "var(--color-accent-fg)"};
  /* Off the motion scale: a determinate fill advances at a constant rate. */
  transition: width 250ms linear;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;
