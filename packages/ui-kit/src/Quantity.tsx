import { Unit } from "./Unit";
import { type FormatQuantityOptions, formatQuantity } from "./units";

/**
 * A number and its unit, rendered together from the unit model.
 *
 * This is the component the app was missing. `formatQuantity` has always
 * returned `{ value, symbol }` as two parts, precisely so the symbol could be
 * styled and announced separately, and then eleven call sites joined them back
 * into a string with a template literal. A joined string cannot be dimmed, cannot
 * be kept off a line break, and above all cannot carry the unit's spoken word,
 * so every one of those readouts announced its unit as letters or, for the
 * plane angles, as nothing at all.
 *
 * `<Quantity value={x} unit="m" />` is the whole fix: it formats through the
 * shared ladder and hands the symbol to `Unit`, which resolves the display
 * form, the icon and the word.
 *
 * Use `speakQuantity` instead where the result has to be a string, which is
 * essentially only `aria-label` and `title`. Do not reach for a template
 * literal: that is the thing this replaces.
 */
export interface QuantityProps extends FormatQuantityOptions {
  /** The value, in whatever unit `unit` names. */
  value: number;
  /** The unit token the contract declares for this field. */
  unit: string;
  className?: string;
}

export function Quantity({ value, unit, className, ...opts }: QuantityProps) {
  const formatted = formatQuantity(value, unit, opts);
  // `symbol`, not `rung`. They agree on a laddered value, and differ exactly
  // where it matters: a duration comes back with the parts interleaved into
  // `value` ("2h 14m") and an EMPTY symbol, while its rung is still "s", so
  // rendering the rung would print a stray "s" beside a formatted duration.
  // An absent value is the same shape, and renders no unit rather than a unit
  // beside an em dash.
  return (
    <span className={className}>
      {formatted.value}
      <Unit>{formatted.symbol}</Unit>
    </span>
  );
}
