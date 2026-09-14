import {
  type BandKind,
  bandFor,
  bandIn,
  value as quantity,
  type Reading,
  readingOf,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { type FillQuantity, fillFraction } from "./fillQuantity";
import { magnitudeOr } from "./magnitude";
import { NullValue } from "./NullValue";
import { Unit } from "./Unit";
import { UnitSharedFormat, useSharedFormat } from "./UnitSharedFormat";
import {
  type FormatQuantityOptions,
  type FormatsFor,
  speakQuantity,
} from "./units";

export type MeterTone = "neutral" | "go" | "warn" | "nogo" | "info";
export type MeterSize = "sm" | "md";

/**
 * How much there is, and what that is a fraction OF.
 *
 * The kit's shared {@link FillQuantity}, under the name this component's call
 * sites already say. One declaration rather than two that agree today: every
 * primitive drawn from a fill takes the same pair, so a widget holding one
 * hands the same object to whichever of them it is drawing into. See that
 * type for why the pair exists at all rather than a pre-divided number.
 */
export type MeterQuantity<U extends string = string> = FillQuantity<U>;

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

/**
 * Everything the bar can be drawn from, in either spelling: the figure alone,
 * or the whole {@link Reading} it arrived in.
 *
 * A WIDENING rather than a replacement, the same shape `UnitValue` takes next
 * door and for the same reason. The two are structurally distinguishable (a
 * `Reading` has a `state`), so every call site written against the narrow form
 * keeps compiling and keeps rendering identically, and a call site converts by
 * handing over what it already holds instead of unwrapping it first.
 */
export type MeterPayload<U extends string = string> = number | MeterQuantity<U>;

/** The internal, normalised form of either prop. See {@link MeterPayload}. */
type MeterInput<U extends string> =
  | MeterPayload<U>
  | Reading<MeterPayload<U>>
  | null;

/** The meter driven by a pre-divided fraction. See {@link MeterProps}. */
export interface MeterFractionProps extends MeterCommonProps {
  /**
   * Fill fraction, 0..1, or the whole {@link Reading} of one. Clamped;
   * non-finite renders empty.
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
   *
   * A `Reading` carrying no number (`pending`, `unowned`, `absent`) renders
   * that same absent form, so a call site needs no gate of its own.
   *
   * The band, where the reading's model offers one, is at the payload ROOT and
   * in `ratio`, since that is what this figure is. A band in any other unit is
   * one the meter cannot place on this track and it draws none; see
   * {@link MeterProps} on why silence beats a guess.
   */
  value: number | Reading<number> | null;
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
   * `null` renders the absent form, exactly as a `null` `value` does, and so
   * does a `Reading` carrying no number.
   *
   * The band, where the reading's model offers one, is the one at `"amount"`
   * and in the amount's own unit: the capacity is the axis rather than the
   * reading, so an interval about it is not something this track can draw.
   */
  quantity: MeterQuantity<U> | Reading<MeterQuantity<U>> | null;
  /**
   * Pin the rung both halves are shown at, for the cases where convention
   * beats magnitude.
   *
   * Rarely needed: absent, the two halves settle a rung between them and are
   * drawn and spoken at it, so 500 kg of a 1000 t tank reads
   * "500.00 kg / 1,000,000.00 kg" rather than putting its two halves in two
   * different units. This is for where neither figure's own ladder is the
   * convention, the same job `format` does on a lone `<Unit>`.
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
 *
 * ## Handed a whole `Reading`, it also draws how well the number is known
 *
 * One mark per band bound, on the track the bar is already drawn on, at the
 * bound's own place along it. Two marks and never a shaded interval: a
 * `sigma1` band is one standard deviation, so the true value sits outside it
 * about a third of the time, and a filled region asserts a containment the
 * commoner of the two kinds never claimed. What the reader takes from a pair of
 * marks is the distance from the bar's end, which is the thing an operator can
 * act on.
 *
 * **The bar keeps showing the OBSERVATION**, marked as not-current when that is
 * what it is, exactly as `<Unit>` does and for the reason that component's own
 * header gives: a modelled number quietly replacing an observed one at every
 * call site is the substitution `Reading` exists to prevent. The marks sit
 * where the model says the value is NOW, so on a stale reading the gap between
 * the bar's end and the pair is how far the model has carried it, and the gap
 * between the marks is how well it claims to know that. Two facts, neither
 * invented.
 *
 * **The band LOOKUP is here and nowhere else.** A widget reaching
 * `reckoned.bands` itself decides for itself what an absent map means, which
 * path its own figure is at, and what unit the interval arrived in, and sixty
 * widgets deciding those separately is how one visual language becomes sixty.
 * So the two prop spellings each say where their own band is (the root for a
 * fraction, `"amount"` for a pair) and narrow it to the unit the track is drawn
 * in. A band in some other unit draws NOTHING rather than a number read as
 * something it is not, which is `bandIn`'s own judgement applied here.
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
  // Unpacked first, so the figure and the statements about it go separate ways.
  // Everything below works on `drawn`, which is what the narrow props carried.
  const { drawn, reading } = unwrap<U>(
    (pair === undefined ? value : pair) as MeterInput<U>,
  );
  const drawnPair =
    pair === undefined ? null : (drawn as MeterQuantity<U> | null);
  const fraction =
    (pair === undefined ? (drawn as number | null) : fillFraction(drawnPair)) ??
    null;
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
  const bar = {
    label,
    pct: Math.round(clamped * 100),
    tone,
    fillColor,
    size,
    ...rest,
  };
  if (drawnPair) {
    // The scope has to enclose the whole bar, not just the header: the rung
    // settled inside it is what `aria-valuetext` is written at, and that
    // attribute sits on the track. See `MeterQuantityBar` on why it is a
    // component of its own.
    return (
      <UnitSharedFormat of={drawnPair.amount.unit} format={format}>
        <MeterQuantityBar
          {...bar}
          pair={drawnPair}
          reading={reading}
          valueLabel={valueLabel}
          valueLabelNode={valueLabelNode}
        />
      </UnitSharedFormat>
    );
  }
  /*
   * The percentage is not hand-written: `clamped` is a 0..1 ratio, which is a
   * unit the kit knows, so <Unit> does the *100 and writes the symbol.
   *
   * Two forms, because they go to two places. The visible one is a NODE, so
   * each symbol keeps its own styling; `aria-valuetext` is an attribute and
   * can only hold a string, which is what `speakQuantity` (or a
   * caller-supplied `valueLabel`) is for. Writing one string for both is what
   * the unit layer exists to stop: it would announce "72 percent-sign".
   */
  const ratio = quantity("ratio", clamped);
  const bounds = boundsOn(reading, RATIO_PATH, "ratio", null);
  return (
    <MeterBar
      {...bar}
      bounds={bounds}
      display={
        valueLabelNode ??
        valueLabel ?? <Unit value={currencyOf(reading, ratio)} />
      }
      spoken={withBand(valueLabel ?? speakQuantity(ratio), bounds)}
    />
  );
}

/** Where a scalar topic's band is: the payload root. */
const RATIO_PATH = "";

/** Where the tank form's band is: the half the track is a fraction OF. */
const AMOUNT_PATH = "amount";

/**
 * The figure to draw, and the reading it came in where it came in one.
 *
 * A bare fraction (and a bare pair, and `null`, and nothing at all) carries no
 * currency and no model, so there is nothing to mark and nothing to place,
 * which is what keeps every unconverted call site byte-identical.
 *
 * The discriminator is guarded on the runtime shape rather than trusted from
 * the declared union, the same way `<Unit>`'s is: a bare number reaches this
 * prop and `in` throws on a primitive.
 */
function unwrap<U extends string>(
  input: MeterInput<U> | undefined,
): {
  drawn: MeterPayload<U> | null;
  reading: Reading<MeterPayload<U>> | null;
} {
  if (typeof input !== "object" || input === null || !("state" in input)) {
    return { drawn: input ?? null, reading: null };
  }
  if (input.state === "observed" || input.state === "stale") {
    return { drawn: input.value, reading: input };
  }
  // pending, unowned and absent, which carry no figure between them. The caller
  // gets the absent form, exactly as a `null` gets.
  return { drawn: null, reading: input };
}

/**
 * The same currency statement, about a figure DERIVED from the reading: the
 * percentage the fraction form writes in its header, or one half of a pair.
 *
 * `readingOf` rather than a hand-rolled copy, because the arms are the part
 * that gets written wrongly and the SDK already enumerates them. It drops the
 * model, which is the honest answer here: the derived figure is not a path any
 * model spoke about, and `<Unit>` would ignore a reckoning anyway.
 */
function currencyOf<T, R>(
  reading: Reading<T> | null,
  shown: R,
): R | Reading<R> {
  return reading === null ? shown : readingOf(reading, () => shown);
}

/**
 * Where a band's two ends sit on the 0..1 track, and what they claim.
 *
 * The ends are kept as the quantities they arrived as and not only as
 * fractions, because the spoken sentence names them in the value's own unit: a
 * tank's interval is litres of fuel rather than a percentage of one.
 *
 * They are kept as the bare `{ magnitude, unit }` `speakQuantity` reads rather
 * than as `Value`s, so this type carries no unit parameter. `Value<U>` is
 * invariant (its comparison methods take a `U` in argument position), so a
 * banded `Value<"units">` does not widen, and a generic here would push that
 * parameter through every function and prop between the lookup and the mark for
 * the sake of two numbers that are only ever written out.
 */
interface MeterBounds {
  lo: number;
  hi: number;
  kind: BandKind;
  /** The low end as it arrived, for the sentence. */
  loSaid: { magnitude: number; unit: string };
  /** The high end as it arrived. */
  hiSaid: { magnitude: number; unit: string };
}

/**
 * The band this reading offers about the bar's own figure, placed on the track.
 *
 * `capacity` is what the two ends are divided by, and `null` says the figure is
 * already a fraction. A capacity of zero is no tank at all, so there is nothing
 * to be a fraction of and nothing to place.
 */
function boundsOn<U extends string>(
  reading: Reading<unknown> | null,
  path: string,
  unit: U,
  capacity: Value<U> | null,
): MeterBounds | null {
  if (reading === null || reading.reckoning !== "available") return null;
  const band = bandIn(bandFor(reading.reckoned, path), unit);
  if (!band) return null;
  const said = { loSaid: band.lo, hiSaid: band.hi, kind: band.kind };
  /*
   * Through the canonical unwrap rather than four reads of its own. A `ratio`
   * end is already the fraction the track is drawn in; a tank's end becomes one
   * by `dividedBy`, which is the same dimension check the fill fraction goes
   * through, and the reason the two ends cannot be in the tank's unit while the
   * capacity is in another.
   */
  if (capacity === null) {
    return {
      lo: magnitudeOr(band.lo, 0),
      hi: magnitudeOr(band.hi, 0),
      ...said,
    };
  }
  if (!capacity.isPositive()) return null;
  return {
    lo: magnitudeOr(band.lo.dividedBy(capacity), 0),
    hi: magnitudeOr(band.hi.dividedBy(capacity), 0),
    ...said,
  };
}

/**
 * The interval appended to what the track is already announcing, because an
 * attribute is the only place a screen reader can be told about a mark that is
 * a shape and nothing else.
 *
 * It names WHAT the interval claims rather than leaving the reader to assume
 * the stronger of the two: crossing a hard bound is impossible, crossing one
 * sigma happens about a third of the time, and the same two numbers mean both
 * until something says which.
 */
function withBand(
  spoken: string,
  bounds: MeterBounds | null,
  shared?: FormatQuantityOptions,
): string {
  if (bounds === null) return spoken;
  const claim = bounds.kind === "sigma1" ? "one sigma" : "bounded";
  const lo = speakQuantity(bounds.loSaid, shared);
  const hi = speakQuantity(bounds.hiSaid, shared);
  return `${spoken}, ${claim} ${lo} to ${hi}`;
}

/**
 * A bound's place along the track, as a percentage the style attribute can
 * hold.
 *
 * Rounded to two decimals rather than to whole percent: a quantised band half a
 * percent wide is a real claim, and rounding it away would draw two marks on
 * top of each other and say the model knows the number exactly. The rounding is
 * still needed, because `0.3 * 100` is not 30 in binary floating point and a
 * style attribute would carry the noise.
 *
 * CLAMPED to the track, so a bound past full pins at the end rather than
 * drawing outside the bar it is about. That is a real case rather than a
 * defensive one: a model fitted near a limit routinely bounds past it, and the
 * mark at the end is the honest reading of "at least this far".
 */
function boundPct(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(clamped * 10_000) / 100;
}

/**
 * A mark's position, as the two style properties that place it.
 *
 * The mark STRADDLES its bound, half a width either side, so it reads as a line
 * at that place rather than as a systematic two pixels of extra interval. At
 * the two ends it tucks fully inside instead: the track is a pill with its
 * overflow hidden, so half a mark hanging off the end is half a mark clipped
 * away, on exactly the bounds (a model fitted hard against a limit) where the
 * mark is the whole of what there is to say.
 */
function markAt(fraction: number): {
  style: { left: string; transform: string };
} {
  const pct = boundPct(fraction);
  const shift = pct <= 0 ? 0 : pct >= 100 ? -2 : -1;
  return { style: { left: `${pct}%`, transform: `translateX(${shift}px)` } };
}

interface MeterBarProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: string;
  /** The fill, as the whole percent `aria-valuenow` and the track both take. */
  pct: number;
  tone: MeterTone;
  fillColor?: string;
  size: MeterSize;
  /** The value for the eye, as markup. */
  display: ReactNode;
  /** The same value for the ear, as the string an attribute can hold. */
  spoken: string;
  /** Where the model's two bounds sit, or `null` where it offers none. */
  bounds: MeterBounds | null;
}

/**
 * The meter as it is DRAWN, given a fill fraction and the two forms of the
 * value that goes with it.
 *
 * Its own component because the quantity form cannot write either form until a
 * rung has been settled, and settling one means being inside a scope that this
 * file's `Meter` renders.
 */
function MeterBar({
  label,
  pct,
  tone,
  fillColor,
  size,
  display,
  spoken,
  bounds,
  ...rest
}: MeterBarProps) {
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
        {/* Decorative, and deliberately so: what the marks say is already in
            `aria-valuetext` above, in words, because a 2px line has no reading
            of its own and two of them announced separately would be noise. */}
        {bounds !== null && (
          <>
            <Meter__Bound
              aria-hidden="true"
              data-bound="lo"
              {...markAt(bounds.lo)}
            />
            <Meter__Bound
              aria-hidden="true"
              data-bound="hi"
              {...markAt(bounds.hi)}
            />
          </>
        )}
      </Meter__Track>
    </Meter__Root>
  );
}

/**
 * The pair, written and SPOKEN at one rung.
 *
 * <p><b>Two halves laddering independently print `999 m / 1.0 km`</b>, which is
 * one tank written in two units. So the two `<Unit>`s are wrapped in the
 * enclosing `<UnitSharedFormat>` and are handed nothing: each reports its own
 * half and applies what the group settles, the way a `<Band>`'s two ends do.</p>
 *
 * <p><b>The spoken half is the one member that cannot report by being
 * rendered.</b> `aria-valuetext` is an attribute holding a string, so there is
 * no `<Unit>` to put in the group, and a `speakQuantity` call left to itself
 * would keep choosing its own rung: a screen-reader user would hear "one
 * kilowatt" against a displayed "1000 W" and neither reader could tell. So this
 * component reports the two halves on the spoken figure's behalf and writes it
 * at what comes back. That is the one honest reason to call the hook outside
 * `<Unit>`, and it is why the hook is published.</p>
 *
 * <p>Separate from `Meter` because the group has to exist before anything can
 * report into it, and a hook cannot see a provider its own component
 * renders.</p>
 */
function MeterQuantityBar<U extends string = string>({
  pair,
  reading,
  valueLabel,
  valueLabelNode,
  ...bar
}: Omit<MeterBarProps, "display" | "spoken" | "bounds"> &
  Pick<MeterQuantityProps<U>, "valueLabel" | "valueLabelNode"> & {
    pair: MeterQuantity<U>;
    reading: Reading<MeterPayload<U>> | null;
  }) {
  // A pair a caller has overridden in BOTH forms is neither drawn nor spoken,
  // so it takes no part in the group: reporting it would move an enclosing
  // scope's rung on behalf of a figure nobody can read. An undefined value is
  // how this hook is told to sit out.
  const grouped = valueLabel === undefined ? pair : undefined;
  const fromAmount = useSharedFormat(grouped?.amount);
  const fromCapacity = useSharedFormat(grouped?.capacity);
  // One group, so both halves hear the same answer; either serves, and on the
  // first pass neither has one yet.
  const shared = fromAmount ?? fromCapacity ?? {};
  const display = valueLabelNode ?? valueLabel ?? (
    <>
      <Unit value={currencyOf(reading, pair.amount)} />
      {" / "}
      <Unit value={currencyOf(reading, pair.capacity)} />
    </>
  );
  const spoken =
    valueLabel ??
    `${speakQuantity(pair.amount, shared)} of ${speakQuantity(pair.capacity, shared)}`;
  /*
   * The band's ends are WRITTEN at the group's rung but never REPORTED into it:
   * they are spoken and nothing else, and a figure nobody can see must not move
   * the rung the two visible halves are drawn at.
   */
  const bounds = boundsOn(
    reading,
    AMOUNT_PATH,
    pair.amount.unit,
    pair.capacity,
  );
  return (
    <MeterBar
      {...bar}
      display={display}
      spoken={withBand(spoken, bounds, shared)}
      bounds={bounds}
    />
  );
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
  /* The frame the bound marks are placed against. They live INSIDE the track
     rather than over it so the same overflow that rounds the fill's ends keeps
     a mark at 0% or 100% inside the pill. */
  position: relative;
  ${({ $size }) => SIZE_TRACK[$size]}
`;

/**
 * One end of the model's interval: a tick across the track at that end's own
 * place along it.
 *
 * Two pixels, full track height, and nothing else. Every part of that is the
 * "readable if you are looking for it, not in your face" the shape was asked
 * for:
 *
 * - it sits ON the track rather than beside it, so the distance the eye reads
 *   is the distance from the bar's end and needs no second axis to be measured
 *   against
 * - two pixels rather than one because the smaller track is four pixels tall,
 *   where a hairline is not a mark, it is dust
 *
 * **Neutral and two-toned, because a mark has to cross the fill.** A bound
 * below the value falls INSIDE the bar, so a single flat colour is a mark that
 * vanishes on one side of the very boundary it is drawn to be read against: at
 * the muted grey a first pass used, the low end disappeared outright over the
 * neutral tone's own fill. So it is a dimmed white with a dark hairline around
 * it, which reads over the empty track, over every status tone, and over a
 * resource's arbitrary identity colour. A TONE here was the other option and is
 * wrong: colour on a meter already means the fill's status, and a second
 * meaning in the same few pixels is how one visual language stops being one.
 */
const Meter__Bound = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--color-text-primary);
  /* The separation from a light or saturated fill. Inset as well as outset so
     the mark keeps an edge whichever side of the bar's end it lands on. */
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.55),
    inset 0 0 0 0.5px rgb(0 0 0 / 0.35);
  opacity: 0.62;
  pointer-events: none;
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
