import { value as quantity, type Value } from "@ksp-gonogo/sitrep-sdk";
import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { NullValue } from "./NullValue";
import { Unit } from "./Unit";
import { type FormatsFor, speakQuantity } from "./units";

export type MeterTone = "neutral" | "go" | "warn" | "nogo" | "info";
export type MeterSize = "sm" | "md";

/**
 * How much there is, and what that is a fraction OF.
 *
 * Both halves are `Value<U>` of the same unit, which is the whole reason this
 * shape exists rather than a pre-divided number: a fill fraction is the one
 * place two quantities have to be the same kind, and a bare
 * `amount / capacity` at a call site is where nothing checks that they were.
 * The meter divides them itself, so the division happens once, under a type
 * that refuses to cross dimensions.
 */
export interface MeterQuantity<U extends string = string> {
  /** How much there is now. */
  amount: Value<U>;
  /** The full tank: what `amount` is read as a fraction of. */
  capacity: Value<U>;
}

interface MeterCommonProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Short label shown above the bar and used as the meter's accessible name. */
  label: string;
  /** Semantic colour of the fill. Ignored when `fillColor` is set. */
  tone?: MeterTone;
  /**
   * Arbitrary CSS colour for the fill (e.g. `resourceColor(name)`), for
   * meters whose fill carries an IDENTITY rather than a status (a resource
   * kind, not "how is it doing"). Wins over `tone` for the fill colour only;
   * `tone` still exists for the status-driven cases (dose, reliability,
   * generic health bars) and is unaffected when this prop is absent.
   */
  fillColor?: string;
  /**
   * Text shown on the right of the header (e.g. "5.0 rad/h"). Defaults to a
   * percentage. Also doubles as the `aria-valuetext` spoken value, so it
   * stays a plain string; pass `valueLabelNode` alongside it when the
   * VISIBLE header needs live markup (e.g. a `<Unit>`) that this string
   * can't carry (an attribute can only hold text).
   */
  valueLabel?: string;
  /**
   * Visual override for the header's value display. Wins over `valueLabel`
   * for what's ON SCREEN, but `aria-valuetext` still reads from `valueLabel`
   * (falling back to the bare percentage), since that's an attribute and
   * can only hold a string. Pass both together: this for the eye, `valueLabel`
   * for the accessibility tree.
   */
  valueLabelNode?: ReactNode;
  size?: MeterSize;
}

/** The meter driven by a pre-divided fraction. See {@link MeterProps}. */
export interface MeterFractionProps extends MeterCommonProps {
  /**
   * Fill fraction, 0..1. Clamped; non-finite renders empty.
   *
   * For a reading that is genuinely unitless where it is read: a count over a
   * count (three of five vessels linked), a fraction the source already
   * derived and whose two halves never reach this call site. Where both halves
   * ARE in hand as quantities, pass `quantity` instead and let the meter
   * divide them, so nothing has to take on faith that they were the same kind.
   *
   * `null` is a reading that never arrived, and it renders as ABSENCE: the
   * header shows `NULL_DISPLAY`, the track is empty, and the row drops
   * `role="meter"` entirely. That last part is the point. A meter asserts a
   * fill fraction and an `aria-valuenow` to go with it, and there is no
   * fraction to assert; drawing an unreported reading as a 0% bar tells the
   * operator the tank is empty rather than that nobody said.
   */
  value: number | null;
  quantity?: never;
  format?: never;
}

/** The meter driven by an amount and a capacity. See {@link MeterProps}. */
export interface MeterQuantityProps<U extends string = string>
  extends MeterCommonProps {
  /**
   * The amount and the capacity it fills. The meter derives the fill fraction
   * AND the header's value text from them, so neither the division nor the
   * "3.0 / 4.0" string is written at the call site.
   *
   * `null` renders the absent form, exactly as a `null` `value` does.
   */
  quantity: MeterQuantity<U> | null;
  /**
   * Pin the rung both halves are shown at, for the cases where convention
   * beats magnitude.
   *
   * Absent, both halves ladder independently, which is right when they are
   * close together and misleading when they are not: a near-empty tank would
   * read "500 g / 1000 kg". Pin it when a meter's two halves can span a rung.
   */
  format?: FormatsFor<U>;
  value?: never;
}

/**
 * Everything a meter needs, in one of two mutually exclusive spellings: a
 * `quantity` pair the meter divides itself, or a `value` fraction already
 * divided. Passing both is a type error, which is the point of the split.
 */
export type MeterProps<U extends string = string> =
  | MeterFractionProps
  | MeterQuantityProps<U>;

/**
 * A labelled horizontal fill bar: the shared visual language for any 0..1
 * quantity (dose, shielding, hunger, resource level, reliability). Pool several
 * into a uniform stack (see `MeterStack`) so a widget's readouts line up.
 *
 * Semantics: the track is `role="meter"` with `aria-valuenow/min/max` and
 * `aria-valuetext` (the human `valueLabel`), named by `label`. Colour never
 * carries meaning alone: the header always shows the value in text. An absent
 * reading renders the absent form instead, see `value`'s own doc.
 */
export function Meter<U extends string = string>({
  label,
  value,
  quantity: pair,
  format,
  tone = "neutral",
  fillColor,
  valueLabel,
  valueLabelNode,
  size = "md",
  ...rest
}: MeterProps<U>) {
  const fraction = (pair === undefined ? value : fractionOf(pair)) ?? null;
  if (fraction === null) {
    return (
      <Meter__Root $size={size} {...rest}>
        <Meter__Head>
          <Meter__Label>{label}</Meter__Label>
          <Meter__Value>
            <NullValue />
          </Meter__Value>
        </Meter__Head>
        {/* Decorative: the track carries no reading, so the label and the
            placeholder beside it are the whole accessible content. */}
        <Meter__Track $size={size} aria-hidden="true" />
      </Meter__Root>
    );
  }
  const clamped = Number.isFinite(fraction)
    ? Math.min(1, Math.max(0, fraction))
    : 0;
  const pct = Math.round(clamped * 100);
  /*
   * What the header says, in the two forms it has to say it, and in priority
   * order: a caller's own node or sentence first, then the quantity pair if
   * one was given, then the bare percentage.
   *
   * The percentage is not hand-written: `clamped` is a 0..1 ratio, which is a
   * unit the kit knows, so <Unit> does the *100 and writes the symbol.
   *
   * Two forms, because they go to two places. The visible one is a NODE, so
   * each symbol keeps its own styling; `aria-valuetext` is an attribute and
   * can only hold a string, which is what `speakQuantity` (or a
   * caller-supplied `valueLabel`) is for. Writing one string for both is what
   * the unit layer exists to stop: it would announce "72 percent-sign".
   */
  const reading = quantity("ratio", clamped);
  const display =
    valueLabelNode ??
    valueLabel ??
    (pair ? (
      <>
        <Unit value={pair.amount} format={format} />
        {" / "}
        <Unit value={pair.capacity} format={format} />
      </>
    ) : (
      <Unit value={reading} />
    ));
  const spoken =
    valueLabel ??
    (pair
      ? `${speakQuantity(pair.amount, { format })} of ${speakQuantity(pair.capacity, { format })}`
      : speakQuantity(reading));
  return (
    <Meter__Root $size={size} {...rest}>
      <Meter__Head>
        <Meter__Label>{label}</Meter__Label>
        <Meter__Value>{display}</Meter__Value>
      </Meter__Head>
      <Meter__Track
        $size={size}
        role="meter"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={spoken}
      >
        <Meter__Fill
          $tone={tone}
          $fillColor={fillColor}
          style={{ width: `${pct}%` }}
        />
      </Meter__Track>
    </Meter__Root>
  );
}

/**
 * The pair, as the 0..1 the track is drawn from.
 *
 * `dividedBy` is what makes the two halves have to be the same kind: an amount
 * in kg over a capacity in litres does not typecheck, and the quotient of two
 * same-kind values is dimensionless by construction. The single `.magnitude`
 * is therefore on a number that has already stopped being a quantity, and it
 * is where a fraction leaves the algebra for the two numeric slots that cannot
 * hold a unit: a CSS width and an `aria-valuenow`.
 *
 * A capacity of zero is not a full tank and not an empty one, it is no tank:
 * the absent form is the honest answer, the same one a `null` gets.
 */
function fractionOf<U extends string>(
  pair: MeterQuantity<U> | null,
): number | null {
  if (pair === null) return null;
  if (!pair.capacity.isPositive()) return null;
  return pair.amount.dividedBy(pair.capacity).magnitude;
}

/** Uniform vertical stack of meters with consistent spacing. */
export const MeterStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  width: 100%;
`;

const TONE_FILL = {
  neutral: css`
    background: var(--color-text-muted);
  `,
  go: css`
    background: var(--color-status-go-bg);
  `,
  warn: css`
    background: var(--color-status-warning-bg);
  `,
  nogo: css`
    background: var(--color-status-nogo-bg);
  `,
  info: css`
    /* The visible info hue (--color-status-info-fg), NOT --color-status-info-bg:
       the -bg token is a near-black subtle panel background and vanishes as a
       filled bar on a dark surface. The other tones' -bg values happen to be
       saturated; info's is not, its saturated counterpart is -fg. */
    background: var(--color-status-info-fg);
  `,
} as const;

const SIZE_TRACK = {
  sm: css`
    height: 4px;
  `,
  md: css`
    height: 8px;
  `,
} as const;

const Meter__Root = styled.div<{ $size: MeterSize }>`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 100%;
  min-width: 0;
`;

const Meter__Head = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-8);
  min-width: 0;
  /* The value may drop to a line of its own at narrow widths (see
     Meter__Value): better a second line than the label being crushed to
     nothing while the value clips through the host's border, which is what
     a nowrap head did at the narrowest tile placements. */
  flex-wrap: wrap;
`;

const Meter__Label = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Never shrink below the name itself: overflow hidden zeroes a flex
     item's automatic minimum size, so without a floor the LABEL is what
     gave way (all the way to invisible) when the head ran out of room. The
     name is the meter's identity; the value wraps below instead. Alone on
     its line a pathological name still ellipsizes via max-width. */
  flex: 0 0 auto;
  max-width: 100%;
`;

const Meter__Value = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex: 0 0 auto;
  /* Pins the value to the trailing edge on the shared line AND when it
     wraps to a line of its own, instead of a wrapped value sitting
     orphaned at flex-start. */
  margin-left: auto;
  /* Last resort at widths where even a line of its own is not enough:
     truncate rather than clip through the host's padding and border. */
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Meter__Track = styled.div<{ $size: MeterSize }>`
  width: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  overflow: hidden;
  ${({ $size }) => SIZE_TRACK[$size]}
`;

const Meter__Fill = styled.div<{ $tone: MeterTone; $fillColor?: string }>`
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width var(--duration-slow) var(--ease-standard);
  /* $fillColor wins outright when set: an identity fill (a resource's own
     colour) isn't "one of five tones", it's a fully arbitrary CSS colour,
     so this is a straight override rather than another TONE_FILL entry. */
  ${({ $tone, $fillColor }) =>
    $fillColor
      ? css`
          background: ${$fillColor};
        `
      : TONE_FILL[$tone]}

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;
