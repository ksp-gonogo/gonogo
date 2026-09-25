import {
  type BandKind,
  bandIn,
  type Reading,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { bandClaim } from "./bandClaim";
import { boundsStandApart } from "./instrumentCurrency";
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

/**
 * What either half of a meter may be handed: the quantity on its own, or the
 * whole {@link Reading} it arrived in.
 *
 * The same pair `<Unit>` takes next door, deliberately, because a meter's
 * header IS two `<Unit>`s: a call site that can draw a figure can fill a bar
 * with it, and neither primitive asks for a shape the other refuses.
 *
 * A whole-topic reading is a TYPE ERROR in both slots. `TopicReading<Value<U>>`
 * maps `Value`'s own members into field readings and claims a value's `abs` and
 * `max` are quantities with a currency, which is nonsense on paper however
 * coherently the proxy behaves at runtime. Reach the field reading off the
 * topic (`flight.altitudeAsl`) and hand THAT over.
 */
export type MeterValue<U extends string = string> =
  | Value<U>
  | Reading<Value<U>>;

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
   * Text shown on the right of the header (e.g. "5.0 rad/h"). Defaults to the
   * figure, drawn through `<Unit>`. Also doubles as the `aria-valuetext` spoken
   * value, so it stays a plain string; pass `valueLabelNode` alongside it when
   * the VISIBLE header needs live markup that this string can't carry (an
   * attribute can only hold text).
   */
  valueLabel?: string;
  /**
   * Visual override for the header's value display. Wins over `valueLabel`
   * for what's ON SCREEN, but `aria-valuetext` still reads from `valueLabel`
   * (falling back to the figure), since that's an attribute and can only hold
   * a string. Pass both together: this for the eye, `valueLabel` for the
   * accessibility tree.
   */
  valueLabelNode?: ReactNode;
}

/**
 * Everything a meter needs: how much there is, and optionally what that is a
 * fraction OF.
 *
 * One spelling rather than the two mutually exclusive ones this took before.
 * The two halves used to arrive bundled in a single object prop, and the
 * bundle bought nothing a second prop does not: it made the pair a shape a
 * caller had to construct, it gave the capacity nowhere to carry a currency of
 * its own, and it needed a whole second props interface to keep it apart from
 * the pre-divided form.
 */
export interface MeterProps<U extends string = string>
  extends MeterCommonProps {
  /**
   * How much there is. With a `capacity` beside it the bar draws the quotient;
   * WITHOUT one, this is already the fraction and must be a `ratio`.
   *
   * A reading carrying no number (`pending`, `unowned`, `absent`) renders the
   * ABSENT form: the header shows `NULL_DISPLAY`, the track is empty, and the
   * row drops `role="meter"` entirely. That last part is the point. A meter
   * asserts a fill fraction and an `aria-valuenow` to go with it, and there is
   * no fraction to assert; drawing an unreported reading as a 0% bar tells the
   * operator the tank is empty rather than that nobody said. So a call site
   * needs no absence gate of its own.
   *
   * `null` says the same thing in one word, for a caller holding a definite
   * quantity that is sometimes simply not there (a resource the craft carries
   * no tank for). It is not a second convention: it renders the identical
   * absent form, and it exists so such a caller need not mint a reading it has
   * no currency for.
   */
  value: MeterValue<U> | null;
  /**
   * The full tank: what `value` is read as a fraction of, in the same unit, so
   * a length over a volume does not typecheck.
   *
   * A `Reading` here is accepted rather than refused, because a capacity is not
   * always a tank. A FATAL THRESHOLD is a capacity, and RP-1's facility tiers
   * move; a capacity that is itself measured goes stale like anything else and
   * may carry a band of its own. See the component header for where each of the
   * two bands is drawn, and why they are never merged into one.
   *
   * ABSENT and `null` are two different statements here and both are used.
   * Absent is a caller with no capacity at all, whose `value` is already the
   * fraction; `null` is a caller who has one and could not read it, which draws
   * the absent form, because an axis nobody could read is not an axis to put a
   * bar against.
   */
  capacity?: MeterValue<U> | null;
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
}

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
 * `reckoning.band` itself decides for itself what an absent one means and what
 * unit the interval arrived in, and sixty widgets deciding those separately is
 * how one visual language becomes sixty. So this narrows each band to the unit
 * the half it belongs to is drawn in, and a band in some other unit draws
 * NOTHING rather than a number read as something it is not, which is `bandIn`'s
 * own judgement applied here.
 *
 * ## The capacity's doubt is drawn at the END, and never merged with the value's
 *
 * The two bands answer two different questions and are drawn in two places:
 *
 * - the **value's** band marks the track where the value is
 * - the **capacity's** band marks the track's END, because the end IS one
 *   whole, and a capacity nobody is sure of is an end nobody is sure of. The
 *   ends are placed as a fraction of the capacity the bar was actually drawn
 *   against, so a capacity that might be smaller marks INSIDE the track
 * - a capacity that is not CURRENT marks the track itself rather than the fill,
 *   because what has gone stale is the axis and not the reading on it
 *
 * **There is deliberately no combined interval.** A fraction of an uncertain
 * whole is uncertain twice over, and combining two intervals is width
 * arithmetic the framework may not do: it cannot know whether the two errors
 * are independent, and a merged band would be it guessing at exactly that. A
 * caller who wants one honest interval wants a MODEL that does the division and
 * publishes a `ratio` reading with a band of its own, which this then draws with
 * no capacity at all. That keeps the arithmetic where the mathematics is known.
 */
export function Meter<U extends string = string>({
  label,
  value,
  capacity,
  format,
  tone = "neutral",
  fillColor,
  valueLabel,
  valueLabelNode,
  ...rest
}: MeterProps<U>) {
  // Unpacked first, so each half's figure and the statements about it go
  // separate ways. Everything below works on the figures.
  const shown = unwrap(value);
  const held = unwrap(capacity);
  const fraction = fillFraction(
    shown.figure,
    capacity === undefined ? undefined : held.figure,
  );
  if (fraction === null) {
    return (
      <Meter__Root {...rest}>
        <Meter__Head>
          <Meter__Label>{label}</Meter__Label>
          <Meter__Value>
            <NullValue />
          </Meter__Value>
        </Meter__Head>
        {/* Decorative: the track carries no reading, so the label and the
            placeholder beside it are the whole accessible content. */}
        <Meter__Track $notCurrent={false} aria-hidden="true" />
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
    // A capacity that has stopped being current marks the TRACK. The fill is
    // still the reading it always was; what is no longer known is the axis it
    // is drawn against, and marking the bar would say the wrong half aged.
    trackNotCurrent: held.reading?.state === "stale",
    /*
     * The FIGURE's own currency, which dims the fill. STALENESS is the whole
     * condition: a held reading is no longer a reading of now whether or not
     * anything named a grade for it, and a bright fill over a held figure says
     * it is current.
     */
    notCurrent: shown.reading?.state === "stale",
    ...rest,
  };
  // Where the capacity's own doubt puts the end of the track, as a fraction of
  // the capacity the bar was drawn against. Independent of the value's band and
  // never combined with it: see the header.
  const endBounds = apartFrom(
    1,
    boundsOn(held.reading, held.figure, held.figure),
  );
  if (capacity !== undefined) {
    // The scope has to enclose the whole bar, not just the header: the rung
    // settled inside it is what `aria-valuetext` is written at, and that
    // attribute sits on the track. See `MeterPairBar` on why it is a component
    // of its own.
    return (
      <UnitSharedFormat of={shown.figure?.unit} format={format}>
        <MeterPairBar
          {...bar}
          value={value}
          capacity={capacity}
          shown={shown}
          held={held}
          endBounds={endBounds}
          at={clamped}
          valueLabel={valueLabel}
          valueLabelNode={valueLabelNode}
        />
      </UnitSharedFormat>
    );
  }
  /*
   * No capacity, so the figure IS the fraction and the header draws it as it
   * arrived: a `ratio` is a unit the kit knows, so `<Unit>` does the *100, the
   * symbol, the staleness mark and the band's own `±`. Handing the prop
   * straight back over is what keeps all four of those decisions in the one
   * component that owns them.
   *
   * Two forms, because they go to two places. The visible one is a NODE, so
   * each symbol keeps its own styling; `aria-valuetext` is an attribute and
   * can only hold a string, which is what `speakQuantity` (or a
   * caller-supplied `valueLabel`) is for. Writing one string for both is what
   * the unit layer exists to stop: it would announce "72 percent-sign".
   */
  const bounds = apartFrom(
    clamped,
    boundsOn(shown.reading, shown.figure, null),
  );
  return (
    <MeterBar
      {...bar}
      bounds={bounds}
      endBounds={endBounds}
      display={valueLabelNode ?? valueLabel ?? <Unit value={value} />}
      spoken={withBands(
        valueLabel ?? speakQuantity(shown.figure),
        bounds,
        endBounds,
      )}
    />
  );
}

/** One half of a meter, split into the figure and the reading it came in. */
interface Half<U extends string> {
  figure: Value<U> | null;
  reading: Reading<Value<U>> | null;
}

/**
 * The figure to draw, and the reading it came in where it came in one.
 *
 * A bare `Value` (and nothing at all) carries no currency and no model, so
 * there is nothing to mark and nothing to place, which is what keeps a call
 * site holding a definite quantity byte-identical to what it drew before.
 *
 * The discriminator is guarded on the runtime shape rather than trusted from
 * the declared union, the same way `<Unit>`'s is: `in` throws on a primitive,
 * and a primitive still reaches these props from untyped JavaScript.
 */
function unwrap<U extends string>(
  input: MeterValue<U> | null | undefined,
): Half<U> {
  if (typeof input !== "object" || input === null || !("state" in input)) {
    return { figure: input ?? null, reading: null };
  }
  /*
   * pending, unowned and absent carry no figure between them, and come through
   * as the absent form. `value` is optional on every arm of a per-value
   * reading, so the presence of the number is the only thing worth asking.
   */
  return { figure: input.value ?? null, reading: input };
}

/**
 * The bar's fill, as the 0..1 a track is drawn from.
 *
 * `dividedBy` is what makes the two halves have to be the same kind: an amount
 * in kg over a capacity in litres does not typecheck, and the quotient of two
 * same-kind values is dimensionless by construction. The single `.magnitude`
 * is therefore on a number that has already stopped being a quantity, and it
 * is where a fraction leaves the algebra for the two numeric slots that cannot
 * hold a unit: a CSS width and an `aria-valuenow`. Both paths converge on that
 * one unwrap rather than each taking its own, which is why the quotient is
 * chosen first and read second.
 *
 * A capacity of zero is not a full tank and not an empty one, it is no tank:
 * `null` is the honest answer, the same one an unread figure gets. `undefined`
 * is the different question of a caller who named no capacity at all, whose
 * figure is already the fraction.
 */
function fillFraction<U extends string>(
  figure: Value<U> | null,
  capacity: Value<U> | null | undefined,
): number | null {
  if (figure === null || capacity === null) return null;
  if (capacity !== undefined && !capacity.isPositive()) return null;
  const drawn = capacity === undefined ? figure : figure.dividedBy(capacity);
  return drawn.magnitude;
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
 * The band this reading offers about its own figure, placed on the track.
 *
 * `over` is what the two ends are divided by, and `null` says the figure is
 * already a fraction. The capacity's own band goes through here too, divided by
 * the capacity itself, which is what puts an uncertain whole at the end of the
 * track rather than somewhere along it.
 *
 * A divisor of zero is no axis at all, so there is nothing to be a fraction of
 * and nothing to place.
 */
function boundsOn<U extends string>(
  reading: Reading<Value<U>> | null,
  figure: Value<U> | null,
  over: Value<U> | null,
): MeterBounds | null {
  if (reading === null || reading.reckoning.status !== "available") return null;
  if (figure === null) return null;
  const band = bandIn(reading.reckoning.band, figure.unit);
  if (!band) return null;
  const said = { loSaid: band.lo, hiSaid: band.hi, kind: band.kind };
  /*
   * Through the canonical unwrap rather than four reads of its own. A `ratio`
   * end is already the fraction the track is drawn in; an end in the figure's
   * own unit becomes one by `dividedBy`, which is the same dimension check the
   * fill fraction goes through, and the reason the two ends cannot be in one
   * unit while the divisor is in another.
   */
  if (over === null) {
    return {
      lo: magnitudeOr(band.lo, 0),
      hi: magnitudeOr(band.hi, 0),
      ...said,
    };
  }
  if (!over.isPositive()) return null;
  return {
    lo: magnitudeOr(band.lo.dividedBy(over), 0),
    hi: magnitudeOr(band.hi.dividedBy(over), 0),
    ...said,
  };
}

/**
 * The bounds, or `null` where every one of them sits on the observation.
 *
 * Unmarked and unspoken alike: a sentence naming bands the eye was not shown
 * would be the two readers told two things. `at` is the observation on the same
 * 0..1 track: the fill's end for the value's band, the track's end for the
 * capacity's, since the end IS the capacity.
 */
function apartFrom(at: number, bounds: MeterBounds | null): MeterBounds | null {
  if (bounds === null) return null;
  return boundsStandApart(at, [bounds.lo, bounds.hi]) ? bounds : null;
}

/**
 * The intervals appended to what the track is already announcing, because an
 * attribute is the only place a screen reader can be told about a mark that is
 * a shape and nothing else.
 *
 * The ends are written here, since only this function knows the rung they
 * settled at; WHAT each pair claims is `bandClaim`'s to say, shared with every
 * other surface that draws a band. Leaving that to the reader to assume would
 * hand them the stronger of two very different statements, and the same two
 * numbers mean both until something says which.
 *
 * The capacity's interval is named as the capacity's, and never folded into the
 * value's. Two clauses is the spoken form of the same rule the marks follow:
 * the framework states two intervals and merges neither.
 */
function withBands(
  spoken: string,
  bounds: MeterBounds | null,
  endBounds: MeterBounds | null,
  shared?: FormatQuantityOptions,
): string {
  const said = (bound: MeterBounds, lead: string): string => {
    const lo = speakQuantity(bound.loSaid, shared);
    const hi = speakQuantity(bound.hiSaid, shared);
    /*
     * "with bands at ... and ...", never the bare "lo to hi" the ticks are
     * drawn from. The bar has already announced its own figure, so a second
     * pair of numbers behind a comma is three numbers in a row to someone
     * listening, and the connector is the only thing telling them which two
     * are the band.
     */
    return bandClaim(bound.kind, `${lead}with bands at ${lo} and ${hi}`);
  };
  const clauses = [
    bounds === null ? null : said(bounds, ""),
    endBounds === null ? null : said(endBounds, "capacity "),
  ].filter((clause): clause is string => clause !== null);
  return clauses.length === 0 ? spoken : `${spoken}, ${clauses.join(", ")}`;
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
  /** Whether the AXIS has stopped being current. See `Meter__Track`. */
  trackNotCurrent: boolean;
  /**
   * The grade's word where the FIGURE has stopped being current, else `null`.
   *
   * One treatment for the whole meter rather than a mark per entry: a stack of
   * rows that each grew their own marker reads as the meter's main content
   * instead of as a statement about it.
   */
  notCurrent: boolean;
  /** The value for the eye, as markup. */
  display: ReactNode;
  /** The same value for the ear, as the string an attribute can hold. */
  spoken: string;
  /** Where the model's two bounds sit, or `null` where it offers none. */
  bounds: MeterBounds | null;
  /** Where an uncertain capacity puts the track's end, or `null`. */
  endBounds: MeterBounds | null;
}

/**
 * The meter as it is DRAWN, given a fill fraction and the two forms of the
 * value that goes with it.
 *
 * Its own component because the two-half form cannot write either form until a
 * rung has been settled, and settling one means being inside a scope that this
 * file's `Meter` renders.
 */
function MeterBar({
  label,
  pct,
  tone,
  fillColor,
  trackNotCurrent,
  notCurrent,
  display,
  spoken,
  bounds,
  endBounds,
  ...rest
}: MeterBarProps) {
  return (
    <Meter__Root {...rest}>
      <Meter__Head>
        <Meter__Label>{label}</Meter__Label>
        <Meter__Value>{display}</Meter__Value>
      </Meter__Head>
      <Meter__Bar>
        <Meter__Track
          $notCurrent={trackNotCurrent}
          data-track-not-current={trackNotCurrent ? "" : undefined}
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
            $notCurrent={notCurrent}
            data-fill-not-current={notCurrent ? "" : undefined}
            style={{ width: `${pct}%` }}
          />
        </Meter__Track>
        {/* Decorative, and deliberately so: what the marks say is already in
            `aria-valuetext` above, in words, because a 2px line has no reading
            of its own and four of them announced separately would be noise. */}
        {(bounds !== null || endBounds !== null) && (
          <Meter__Marks aria-hidden="true">
            {bounds !== null && (
              <>
                <Meter__Bound data-bound="lo" {...markAt(bounds.lo)} />
                <Meter__Bound data-bound="hi" {...markAt(bounds.hi)} />
              </>
            )}
            {endBounds !== null && (
              <>
                <Meter__Bound data-end-bound="lo" {...markAt(endBounds.lo)} />
                <Meter__Bound data-end-bound="hi" {...markAt(endBounds.hi)} />
              </>
            )}
          </Meter__Marks>
        )}
      </Meter__Bar>
    </Meter__Root>
  );
}

/**
 * The two halves, written and SPOKEN at one rung.
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
function MeterPairBar<U extends string = string>({
  value,
  capacity,
  shown,
  held,
  at,
  valueLabel,
  valueLabelNode,
  ...bar
}: Omit<MeterBarProps, "display" | "spoken" | "bounds"> &
  Pick<MeterProps<U>, "valueLabel" | "valueLabelNode"> & {
    value: MeterValue<U> | null;
    capacity: MeterValue<U> | null;
    shown: Half<U>;
    held: Half<U>;
    /** Where the fill ends, as the 0..1 the bounds are compared against. */
    at: number;
  }) {
  // A figure a caller has overridden in BOTH forms is neither drawn nor spoken,
  // so it takes no part in the group: reporting it would move an enclosing
  // scope's rung on behalf of a figure nobody can read. An undefined value is
  // how this hook is told to sit out.
  const reporting = valueLabel === undefined;
  const fromValue = useSharedFormat(reporting ? shown.figure : undefined);
  const fromCapacity = useSharedFormat(reporting ? held.figure : undefined);
  // One group, so both halves hear the same answer; either serves, and on the
  // first pass neither has one yet.
  const shared = fromValue ?? fromCapacity ?? {};
  const display = valueLabelNode ?? valueLabel ?? (
    <>
      <Unit value={value} />
      {" / "}
      <Unit value={capacity} />
    </>
  );
  const spoken =
    valueLabel ??
    `${speakQuantity(shown.figure, shared)} of ${speakQuantity(held.figure, shared)}`;
  /*
   * The band's ends are WRITTEN at the group's rung but never REPORTED into it:
   * they are spoken and nothing else, and a figure nobody can see must not move
   * the rung the two visible halves are drawn at.
   */
  const bounds = apartFrom(
    at,
    boundsOn(shown.reading, shown.figure, held.figure),
  );
  return (
    <MeterBar
      {...bar}
      display={display}
      spoken={withBands(spoken, bounds, bar.endBounds, shared)}
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

/**
 * The one track height a meter has, and the one mark height that goes with it.
 *
 * There used to be two, a four-pixel `sm` and an eight-pixel `md`, chosen by a
 * `size` prop. Nothing about a bar's meaning changed between them, so a reader
 * met the same statement drawn at two heights with no way to tell which they
 * were looking at, and the axis was carrying a density preference rather than
 * anything a meter says. Eight is the survivor because it is the height every
 * direct caller already got: `size` defaulted to `md`, and only `WidgetMeters`
 * defaulted the other way.
 *
 * A mark sits one pixel inside each edge, which is six pixels of tick on an
 * eight-pixel track (the box is border-box, so the 1px border is inside the
 * eight). The marks are still a layer of their own rather than children of the
 * track: the track's `overflow: hidden` is what rounds the FILL's ends, and a
 * mark inside it would be clipped to the track's own height.
 */
const TRACK_HEIGHT = "8px";
const MARK_INSET = "1px";

const Meter__Root = styled.div`
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
  font-size: var(--font-size-caption);
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
  font-size: var(--font-size-value);
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
  /* Room for the not-current mark, which Unit draws OUTSIDE this box at
     left:100% and the overflow above would otherwise eat whole. Measured
     rather than chosen: the mark is max(0.3em, 4px) wide plus a 0.14em
     margin, and a probe of the real clip put its right edge 6px past this
     box, which is the --space-6 rung exactly. Anything smaller still clips.

     Reserved unconditionally, because a width that appeared only when a
     channel went quiet is exactly the reflow the mark is absolutely
     positioned to avoid. */
  padding-right: max(0.44em, var(--space-6));
`;

/* The bar's axis.
   A DASHED border where the capacity it is drawn against has stopped being
   current: the axis is the one thing a capacity reading owns here, so an aged
   capacity ages the track and leaves the fill alone. The border and not the
   fill, and not a hue either, for `Meter__Bound`'s reason: colour on a meter
   already means the fill's status, and a second meaning in the same few pixels
   is how one visual language stops being one. A dash reads as provisional
   whether or not the reader can separate the two greys (WCAG 1.4.1), and the
   words are in `aria-valuetext`. */

const Meter__Track = styled.div<{ $notCurrent: boolean }>`
  width: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-surface-raised);
  border: 1px ${({ $notCurrent }) => ($notCurrent ? "dashed" : "solid")}
    var(--color-border-subtle);
  overflow: hidden;
  /* Positioned for the fill, which is its only child. The bound marks are NOT
     in here: this overflow rounds the fill's ends, and it would take a mark's
     height with it. */
  position: relative;
  height: ${TRACK_HEIGHT};
`;

/**
 * One end of the model's interval: a tick across the track at that end's own
 * place along it.
 *
 * Two pixels wide, six tall, and nothing else. Every part of that is the
 * "readable if you are looking for it, not in your face" the shape was asked
 * for:
 *
 * - it sits ON the track rather than beside it, so the distance the eye reads
 *   is the distance from the bar's end and needs no second axis to be measured
 *   against
 * - two pixels wide rather than one, because a hairline on a bar this short is
 *   not a mark, it is dust
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
/* The layer the marks are drawn in, OVER the track rather than inside it. The
   track keeps its own overflow, because that is what rounds the FILL's ends;
   the marks no longer pay for it with their height.

   Horizontal containment is unaffected and never came from the clip: `markAt`
   already tucks an end mark fully inside the track's width, which is why a
   mark at 0% or 100% still sits on the bar rather than beside it. */
const Meter__Marks = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
`;

/* The bar: the track and the marks over it, in one box the marks can be
   positioned against. */
const Meter__Bar = styled.div`
  position: relative;
`;

const Meter__Bound = styled.div`
  position: absolute;
  top: ${MARK_INSET};
  bottom: ${MARK_INSET};
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

const Meter__Fill = styled.div<{
  $tone: MeterTone;
  $fillColor?: string;
  $notCurrent: boolean;
}>`
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width var(--duration-slow) var(--ease-standard);
  /* Dimmed rather than recoloured, and the FILL rather than the whole meter.
     A second hue here would be read as the status the fill's colour already
     carries, and dimming the root would take the label and the figure with it,
     which is the one thing a held reading must stay readable as. */
  ${({ $notCurrent }) => ($notCurrent ? "opacity: 0.55;" : "")}
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
