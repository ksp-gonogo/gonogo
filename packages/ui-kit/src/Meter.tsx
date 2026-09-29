import {
  type BandKind,
  bandIn,
  type Reading,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  type HTMLAttributes,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react";
import styled, { css } from "styled-components";
import { bandClaim } from "./bandClaim";
import { HeldFigure, HeldHost, HeldMark } from "./HeldMark";
import { magnitudeOr } from "./magnitude";
import { NullValue } from "./NullValue";
import { resolveCurrency, type UnitValue } from "./readingCurrency";
import { placedOnScale, standsApart } from "./standsApart";
import type { StatTone } from "./statTone";
import { severityDotColor } from "./status/severityDotColor";
import { Unit } from "./Unit";
import { UnitSharedFormat, useSharedFormat } from "./UnitSharedFormat";
import {
  type FormatQuantityOptions,
  type FormatsFor,
  speakQuantity,
} from "./units";

/**
 * Where a meter's label and figure sit relative to its bar.
 *
 * - `stacked`: the label and the figure on a line, the bar beneath them. The
 *   default, for a meter that is a readout in its own right
 * - `row`: label, bar and figure on one line, for a list of meters read down a
 *   column. Where the line runs out of room the figure, then the bar, wraps
 *   rather than being clipped. Inside a `MeterStack` every row lines up
 *
 * @category Meter
 */
export type MeterLayout = "stacked" | "row";

interface MeterCommonProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Short label shown above the bar and used as the meter's accessible name. */
  label: string;
  /**
   * Semantic colour of the fill. Ignored when `fillColor` is set.
   *
   * @defaultValue `"neutral"`
   */
  tone?: StatTone;
  /**
   * Arbitrary CSS colour for the fill (e.g. `resourceColor(name)`), for meters
   * whose fill carries an identity rather than a status. Wins over `tone` for
   * the fill colour only.
   */
  fillColor?: string;
  /**
   * Text shown on the right of the header (e.g. "5.0 rad/h"). Defaults to the
   * figure, drawn through `<Unit>`. Also the `aria-valuetext`, so it stays a
   * plain string; pass `valueLabelNode` alongside it for visible markup.
   */
  valueLabel?: string;
  /**
   * Visual override for the header's value display. `aria-valuetext` still
   * reads `valueLabel`, so pass both: this for the eye, `valueLabel` for the
   * accessibility tree.
   */
  valueLabelNode?: ReactNode;
  /**
   * Where the label and figure sit relative to the bar. See {@link MeterLayout}.
   *
   * @defaultValue `"stacked"`
   */
  layout?: MeterLayout;
}

/**
 * The props of {@link Meter}.
 *
 * @category Meter
 */
export interface MeterProps<UnitSymbol extends string = string>
  extends MeterCommonProps {
  /**
   * How much there is. Without a `capacity` it must already be a fraction, in
   * `ratio`. A {@link Reading} is accepted.
   *
   * `null`, or a reading with no value, draws a dash and an empty track, so
   * there is no need to check for a missing value first.
   */
  value: UnitValue<UnitSymbol> | null;
  /**
   * The whole that `value` is a fraction of, in the same unit. A
   * {@link Reading} is accepted. `null` is a capacity that could not be read,
   * and draws a dash.
   */
  capacity?: UnitValue<UnitSymbol> | null;
  /**
   * Fixes the unit `value` and `capacity` are written in. Rarely needed: by
   * default the two share one unit, chosen by magnitude.
   */
  format?: FormatsFor<UnitSymbol>;
}

/**
 * A labelled bar showing how full something is: a dose, a resource level, a
 * reliability. The value is always written beside the bar, so colour never
 * carries meaning alone.
 *
 * Pass `value` alone when it is already a fraction, in `ratio`, or `value` and
 * `capacity` in the same unit for an amount out of a whole.
 *
 * ## Missing and held values
 *
 * With no number to show, the meter draws a dash and an empty track, never a
 * 0% bar. Given a {@link Reading}, a held value is marked as held, and a held
 * capacity draws the track dashed.
 *
 * ## Bands
 *
 * Where a reading carries an uncertainty band, the meter draws a tick at each
 * end of it on the track: two marks, never a shaded interval. The bar still
 * shows the observed value, and the ticks sit where the forward model puts the
 * value now. A band on the capacity is ticked near the track's end, as a
 * fraction of the capacity drawn. A band in a different unit from the value or
 * capacity it belongs to draws nothing.
 *
 * @example A fraction on its own, which must be a `ratio`
 * ```tsx
 * <Meter label="Shielding" value={value("ratio", 0.72)} tone="go" />
 * ```
 *
 * @example An amount out of a capacity in the same unit
 * ```tsx
 * <Meter label="Ore" value={value("kg", 120)} capacity={value("kg", 400)} />
 * ```
 *
 * @example Row meters in a stack, sharing columns so every bar lines up
 * ```tsx
 * <MeterStack>
 *   <Meter label="LF" layout="row" value={liquidFuel} capacity={liquidFuelMax} />
 *   <Meter label="Ox" layout="row" value={oxidizer} capacity={oxidizerMax} />
 * </MeterStack>
 * ```
 *
 * @category Meter
 */
export function Meter<UnitSymbol extends string = string>({
  label,
  value,
  capacity,
  format,
  tone = "neutral",
  fillColor,
  valueLabel,
  valueLabelNode,
  layout = "stacked",
  ...rest
}: MeterProps<UnitSymbol>) {
  const shown = unwrap(value);
  const held = unwrap(capacity);
  const fraction = fillFraction(
    shown.figure,
    capacity === undefined ? undefined : held.figure,
  );
  if (fraction === null || !Number.isFinite(fraction)) {
    return (
      <MeterFrame
        layout={layout}
        label={label}
        display={<NullValue />}
        {...rest}
      >
        {/* Decorative: the label and placeholder are the whole accessible content. */}
        <Meter__Track $held={false} aria-hidden="true" />
      </MeterFrame>
    );
  }
  const clamped = Math.min(1, Math.max(0, fraction));
  const bar = {
    label,
    layout,
    pct: Math.round(clamped * 100),
    tone,
    fillColor,
    // A held capacity marks the track: the axis aged, not the reading on it.
    trackHeld: held.reading?.state === "held",
    fillHeld: shown.reading?.state === "held",
    ...rest,
  };
  const endBounds = apartFrom(
    1,
    boundsOn(held.reading, held.figure, held.figure),
  );
  if (capacity !== undefined) {
    // The scope encloses the whole bar, since `aria-valuetext` on the track is written at the settled rung.
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
   * No capacity, so the figure is the fraction and `<Unit>` draws it as it
   * arrived. The visible form is a node; `aria-valuetext` is a string from
   * `speakQuantity`, so it never announces "72 percent-sign".
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
      display={
        valueLabelNode ??
        (valueLabel === undefined ? (
          <Unit value={value} format={format} />
        ) : (
          <HeldLabel caption={heldCaption(value)}>{valueLabel}</HeldLabel>
        ))
      }
      spoken={withBands(
        valueLabel === undefined
          ? speakQuantity(shown.figure, { format })
          : sayCaption(valueLabel, heldCaption(value)),
        bounds,
        endBounds,
      )}
    />
  );
}

/** What a held reading's mark means in words, or null where the figure is current. */
function heldCaption<UnitSymbol extends string>(
  input: UnitValue<UnitSymbol> | null | undefined,
): string | null {
  const { held, caption } = resolveCurrency(input ?? null);
  return held ? caption : null;
}

/** A caller's own words for the figure, with the held reading's words after them. */
function sayCaption(label: string, caption: string | null): string {
  return caption === null ? label : `${label}, ${caption}`;
}

/**
 * A caller's own string label for the figure, carrying the same held mark and
 * words `<Unit>` would have drawn, so a held meter always looks held. A
 * `valueLabelNode` is drawn as given: it holds its own `<Unit>`s, which mark
 * themselves.
 */
function HeldLabel({
  caption,
  children,
}: {
  caption: string | null;
  children: ReactNode;
}) {
  if (caption === null) return <>{children}</>;
  return <HeldFigure caption={caption}>{children}</HeldFigure>;
}

/** One half of a meter, split into the figure and the reading it came in. */
interface Half<UnitSymbol extends string> {
  figure: Value<UnitSymbol> | null;
  reading: Reading<Value<UnitSymbol>> | null;
}

/**
 * The figure to draw, and the reading it came in where it came in one. The
 * discriminator is guarded on the runtime shape, since `in` throws on a
 * primitive and untyped JavaScript can pass one.
 */
function unwrap<UnitSymbol extends string>(
  input: UnitValue<UnitSymbol> | null | undefined,
): Half<UnitSymbol> {
  if (typeof input !== "object" || input === null || !("state" in input)) {
    return { figure: input ?? null, reading: null };
  }
  return { figure: input.value ?? null, reading: input };
}

/**
 * The bar's fill, as the 0..1 a track is drawn from. `dividedBy` makes the two
 * halves the same kind, so the quotient is dimensionless. A capacity of zero is
 * no tank at all, so it yields `null`.
 */
function fillFraction<UnitSymbol extends string>(
  figure: Value<UnitSymbol> | null,
  capacity: Value<UnitSymbol> | null | undefined,
): number | null {
  if (figure === null || capacity === null) return null;
  if (capacity !== undefined && !capacity.isPositive()) return null;
  const drawn = capacity === undefined ? figure : figure.dividedBy(capacity);
  return drawn.magnitude;
}

/**
 * Where a band's two ends sit on the 0..1 track, and what they claim. The ends
 * are also kept as the bare quantities they arrived as, because the spoken
 * sentence names them in the value's own unit.
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
 * `over` is what the two ends are divided by; `null` says the figure is already
 * a fraction. A divisor of zero places nothing.
 */
function boundsOn<UnitSymbol extends string>(
  reading: Reading<Value<UnitSymbol>> | null,
  figure: Value<UnitSymbol> | null,
  over: Value<UnitSymbol> | null,
): MeterBounds | null {
  if (reading === null || reading.reckoning.status !== "available") return null;
  if (figure === null) return null;
  const band = bandIn(reading.reckoning.band, figure.unit);
  if (!band) return null;
  const said = { loSaid: band.lo, hiSaid: band.hi, kind: band.kind };
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
 * The bounds, or `null` where every one of them sits on the observation, so
 * they are neither marked nor spoken. `at` is the observation on the 0..1
 * track: the fill's end for the value's band, the track's end for the capacity's.
 */
function apartFrom(at: number, bounds: MeterBounds | null): MeterBounds | null {
  if (bounds === null) return null;
  return standsApart(at, [bounds.lo, bounds.hi], placedOnScale())
    ? bounds
    : null;
}

/**
 * The intervals appended to what the track already announces, since the marks
 * are shapes with no reading of their own. What each pair claims is
 * `bandClaim`'s to say; the capacity's interval is its own clause.
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
    // The connector tells a listener which two of three numbers are the band.
    return bandClaim(bound.kind, `${lead}with bands at ${lo} and ${hi}`);
  };
  const clauses = [
    bounds === null ? null : said(bounds, ""),
    endBounds === null ? null : said(endBounds, "capacity "),
  ].filter((clause): clause is string => clause !== null);
  return clauses.length === 0 ? spoken : `${spoken}, ${clauses.join(", ")}`;
}

/**
 * A bound's place along the track, as a percentage. Two decimals, since a band
 * half a percent wide is a real claim; clamped, since a model fitted near a
 * limit routinely bounds past it.
 */
function boundPct(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.round(clamped * 10_000) / 100;
}

/**
 * A mark's position. It straddles its bound, except at the two ends, where it
 * tucks fully inside the track so it is not clipped.
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
  layout: MeterLayout;
  /** The fill, as the whole percent `aria-valuenow` and the track both take. */
  pct: number;
  tone: StatTone;
  fillColor?: string;
  /** Whether the AXIS has stopped being current. See `Meter__Track`. */
  trackHeld: boolean;
  /**
   * Whether the figure has stopped being current: one treatment for the whole
   * meter rather than a mark per entry.
   */
  fillHeld: boolean;
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
 * The meter as it is drawn, given a fill fraction and the two forms of the
 * value that goes with it.
 */
function MeterBar({
  label,
  layout,
  pct,
  tone,
  fillColor,
  trackHeld,
  fillHeld,
  display,
  spoken,
  bounds,
  endBounds,
  ...rest
}: MeterBarProps) {
  return (
    <MeterFrame layout={layout} label={label} display={display} {...rest}>
      <Meter__Track
        $held={trackHeld}
        data-track-held={trackHeld ? "" : undefined}
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
          $held={fillHeld}
          data-fill-held={fillHeld ? "" : undefined}
          style={{ width: `${pct}%` }}
        />
      </Meter__Track>
      {/* Decorative: what the marks say is already in `aria-valuetext`. */}
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
    </MeterFrame>
  );
}

/**
 * The label, the figure and the bar, placed by `layout`.
 *
 * `children` is what goes in the bar: the track, and the marks over it. In the
 * stacked form the label and figure share a head line above it; in the row form
 * all three are siblings on one line, the bar between the two words.
 */
function MeterFrame({
  layout,
  label,
  display,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  layout: MeterLayout;
  label: string;
  display: ReactNode;
  children: ReactNode;
}) {
  if (layout === "row") {
    return (
      <Meter__Root $row data-meter-row="" {...rest}>
        <Meter__Label data-meter-part="label">{label}</Meter__Label>
        <Meter__Bar $row data-meter-part="bar">
          {children}
        </Meter__Bar>
        <Meter__Value $row data-meter-part="figure">
          {display}
        </Meter__Value>
      </Meter__Root>
    );
  }
  return (
    <Meter__Root $row={false} {...rest}>
      <Meter__Head>
        <Meter__Label>{label}</Meter__Label>
        <Meter__Value $row={false}>{display}</Meter__Value>
      </Meter__Head>
      <Meter__Bar $row={false}>{children}</Meter__Bar>
    </Meter__Root>
  );
}

/**
 * The two halves, written and spoken at one rung, so a tank never reads
 * `999 m / 1.0 km`. The `<Unit>`s report into the enclosing
 * `<UnitSharedFormat>`; the spoken string cannot report by rendering, so this
 * component reports on its behalf and writes it at the settled rung.
 */
function MeterPairBar<UnitSymbol extends string = string>({
  value,
  capacity,
  shown,
  held,
  at,
  valueLabel,
  valueLabelNode,
  ...bar
}: Omit<MeterBarProps, "display" | "spoken" | "bounds"> &
  Pick<MeterProps<UnitSymbol>, "valueLabel" | "valueLabelNode"> & {
    value: UnitValue<UnitSymbol> | null;
    capacity: UnitValue<UnitSymbol> | null;
    shown: Half<UnitSymbol>;
    held: Half<UnitSymbol>;
    /** Where the fill ends, as the 0..1 the bounds are compared against. */
    at: number;
  }) {
  // A figure overridden in both forms is neither drawn nor spoken, so it sits out of the group.
  const reporting = valueLabel === undefined;
  const fromValue = useSharedFormat(reporting ? shown.figure : undefined);
  const fromCapacity = useSharedFormat(reporting ? held.figure : undefined);
  // One group, so both halves hear the same answer; either serves, and on the first pass neither has one yet.
  const shared = fromValue ?? fromCapacity ?? {};
  /*
   * A row writes the symbol once, after the capacity (`960 / 1,000 units`), and
   * the pair carries one held mark at its end. Which half aged is still
   * drawn on the bar.
   */
  const caption = heldCaption(value) ?? heldCaption(capacity);
  const display =
    valueLabelNode ??
    (valueLabel !== undefined ? (
      <HeldLabel caption={caption}>{valueLabel}</HeldLabel>
    ) : bar.layout === "row" ? (
      <Meter__Pair>
        <Unit value={value} hideUnitInGroup />
        {" / "}
        <Unit value={capacity} />
        {(bar.fillHeld || bar.trackHeld) && (
          <HeldMark aria-hidden="true" data-held-mark="" />
        )}
      </Meter__Pair>
    ) : (
      <>
        <Unit value={value} />
        {" / "}
        <Unit value={capacity} />
      </>
    ));
  const spoken =
    valueLabel === undefined
      ? `${speakQuantity(shown.figure, shared)} of ${speakQuantity(held.figure, shared)}`
      : sayCaption(valueLabel, caption);
  // The band's ends are written at the group's rung but never reported into it, since they are only spoken.
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

/**
 * The narrowest a row meter's bar is drawn in a `MeterStack`, in pixels. A
 * number, since the stack does arithmetic with it.
 */
const ROW_BAR_FLOOR_PX = 48;

/**
 * A vertical list of meters. Row meters in it share columns, so every label,
 * bar and figure lines up. Where the figures do not fit beside the bars, every
 * figure moves under its bar.
 *
 * @category Meter
 */
export function MeterStack({
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const stack = ref.current;
    if (!stack || typeof ResizeObserver === "undefined") return;
    const place = () => {
      // A stack that has not been laid out has no width to decide against.
      if (stack.clientWidth === 0) return;
      stack.toggleAttribute("data-figures-below", !figuresFitBeside(stack));
    };
    // Every label and figure is observed too, since a figure growing a digit can push the list over the line.
    const resize = new ResizeObserver(place);
    const watch = () => {
      resize.disconnect();
      resize.observe(stack);
      for (const part of rowParts(stack)) resize.observe(part);
    };
    const rows = new MutationObserver(watch);
    rows.observe(stack, { childList: true, subtree: true });
    watch();
    place();
    return () => {
      resize.disconnect();
      rows.disconnect();
    };
  }, []);
  return (
    <Meter__Stack ref={ref} {...rest}>
      {children}
    </Meter__Stack>
  );
}

/**
 * Keeps a row meter on its `MeterStack`'s columns while it shares a slot with
 * other lines, such as a caption under the bar.
 *
 * @category Meter
 */
export const MeterRowGroup = styled.div.attrs({
  "data-meter-row-group": "",
} as HTMLAttributes<HTMLDivElement>)`
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  row-gap: var(--gap-meter-rows);
  min-width: 0;

  & > * {
    grid-column: 1 / -1;
    min-width: 0;
  }
`;

/** The labels and figures of the row meters the stack lines up. */
function rowParts(stack: HTMLElement): HTMLElement[] {
  return Array.from(
    stack.querySelectorAll<HTMLElement>(
      ':scope > [data-meter-row] > [data-meter-part="label"], ' +
        ':scope > [data-meter-row] > [data-meter-part="figure"], ' +
        ':scope > [data-meter-row-group] > [data-meter-row] > [data-meter-part="label"], ' +
        ':scope > [data-meter-row-group] > [data-meter-row] > [data-meter-part="figure"]',
    ),
  );
}

/**
 * Whether the widest label, a bar at its floor and the widest figure fit on
 * one line of the stack.
 *
 * Measured from the parts' own content widths, which do not change with the
 * decision, so the answer does not flip-flop.
 */
function figuresFitBeside(stack: HTMLElement): boolean {
  const parts = rowParts(stack);
  if (parts.length === 0) return true;
  let label = 0;
  let figure = 0;
  for (const part of parts) {
    if (part.dataset.meterPart === "label") {
      label = Math.max(label, unwrappedWidth(part));
    } else {
      figure = Math.max(figure, part.scrollWidth);
    }
  }
  const style = getComputedStyle(stack);
  const px = (v: string) => Number.parseFloat(v) || 0;
  const gap = px(style.columnGap);
  const room =
    stack.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
  return label + gap + ROW_BAR_FLOOR_PX + gap + figure <= room;
}

/**
 * A label's width on one line, read with wrapping briefly turned off, since a
 * wrapped label takes the column's width rather than its own.
 */
function unwrappedWidth(label: HTMLElement): number {
  const before = label.style.whiteSpace;
  label.style.whiteSpace = "nowrap";
  const width = label.scrollWidth;
  label.style.whiteSpace = before;
  return width;
}

/*
 * Three columns: label, bar, figure, or two with the figures below. A label
 * wraps rather than truncating, since a truncated name reads as a different meter.
 */
const Meter__Stack = styled.div`
  display: grid;
  grid-template-columns:
    minmax(min-content, max-content)
    minmax(${ROW_BAR_FLOOR_PX}px, 1fr)
    max-content;
  gap: var(--gap-meter-columns);
  width: 100%;

  & > * {
    grid-column: 1 / -1;
    min-width: 0;
  }

  & > [data-meter-row],
  & > [data-meter-row-group] > [data-meter-row] {
    display: grid;
    grid-template-columns: subgrid;
    column-gap: normal;
  }

  & > [data-meter-row] > [data-meter-part="label"],
  & > [data-meter-row-group] > [data-meter-row] > [data-meter-part="label"] {
    white-space: normal;
  }

  &[data-figures-below] {
    grid-template-columns:
      minmax(min-content, max-content)
      minmax(${ROW_BAR_FLOOR_PX}px, 1fr);
  }

  &[data-figures-below] > [data-meter-row] > [data-meter-part="bar"],
  &[data-figures-below]
    > [data-meter-row-group]
    > [data-meter-row]
    > [data-meter-part="bar"] {
    grid-column: 2 / -1;
  }

  &[data-figures-below] > [data-meter-row] > [data-meter-part="figure"],
  &[data-figures-below]
    > [data-meter-row-group]
    > [data-meter-row]
    > [data-meter-part="figure"] {
    grid-column: 1 / -1;
  }
`;

const TONE_FILL = {
  neutral: css`
    background: var(--color-text-muted);
  `,
  go: css`
    background: var(--color-status-go-mark);
  `,
  warn: css`
    background: var(--color-status-warning-bg);
  `,
  nogo: css`
    background: var(--color-status-nogo-bg);
  `,
  info: css`
    /* The info -fg token, because info's -bg is a near-black panel background that vanishes as a fill. */
    background: var(--color-status-info-fg);
  `,
} as const;

/**
 * The one track height a meter has. A mark sits one pixel inside each edge, in
 * a layer over the track, since the track's `overflow: hidden` rounds the fill.
 */
const TRACK_HEIGHT = "8px";
const MARK_INSET = "1px";

/* In the row form the three parts wrap rather than shrink. */
const Meter__Root = styled.div<{ $row: boolean }>`
  display: flex;
  width: 100%;
  min-width: 0;
  ${({ $row }) =>
    $row
      ? css`
          flex-direction: row;
          flex-wrap: wrap;
          align-items: center;
          column-gap: var(--gap-meter-columns);
          row-gap: var(--gap-caption);
        `
      : css`
          flex-direction: column;
          gap: var(--gap-caption);
        `}
`;

const Meter__Head = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--gap-label-value);
  min-width: 0;
  /* The value may drop to its own line at narrow widths rather than crushing the label. */
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
  /* Never shrinks below the name: overflow hidden zeroes a flex item's automatic minimum size. */
  flex: 0 0 auto;
  max-width: 100%;
`;

/* The row form writes its figure a step smaller, so a dense list keeps one line per meter. */
const Meter__Value = styled.span<{ $row: boolean }>`
  font-size: ${({ $row }) =>
    $row ? "var(--font-size-compact)" : "var(--font-size-value)"};
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  flex: 0 0 auto;
  /* Pins the value to the trailing edge on the shared line and when it wraps to its own. */
  margin-left: auto;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  /* Room for the held mark Unit draws outside this box, reserved unconditionally so a quiet channel causes no reflow. */
  padding-right: max(0.44em, var(--inset-meter-mark));
`;

/* The bar's axis, dashed where the capacity has stopped being current: colour already means the fill's status. */
/* A held capacity dashes the track's edge in the held mark's hue, which clears 3:1 against the panel where the subtle border does not. */
const Meter__Track = styled.div<{ $held: boolean }>`
  width: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-surface-raised);
  border: 1px
    ${({ $held }) =>
      $held
        ? `dashed ${severityDotColor("warning")}`
        : "solid var(--color-border-subtle)"};
  overflow: hidden;
  /* Positioned for the fill only: this overflow rounds the fill's ends and would clip the bound marks. */
  position: relative;
  height: ${TRACK_HEIGHT};
`;

/* The layer the marks are drawn in, over the track rather than inside its clip. */
const Meter__Marks = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
`;

/* The track and the marks over it, in one box the marks are positioned against. */
const Meter__Bar = styled.div<{ $row: boolean }>`
  position: relative;
  ${({ $row }) =>
    $row
      ? css`
          flex: 1 1 28px;
          min-width: 28px;
        `
      : ""}
`;

/* One nowrap box for the row form's pair, so its single held mark hangs off the end of the phrase. */
const Meter__Pair = styled(HeldHost)`
  & > span > [data-held-mark] {
    display: none;
  }
`;

/**
 * One end of the model's interval: a 2px tick across the track. Neutral and
 * two-toned (dimmed white with a dark hairline) so it reads over the empty
 * track and over any fill colour.
 */
const Meter__Bound = styled.div`
  position: absolute;
  top: ${MARK_INSET};
  bottom: ${MARK_INSET};
  width: 2px;
  background: var(--color-text-primary);
  /* Inset and outset, so the mark keeps an edge against a light or saturated fill on either side of its end. */
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 0.55),
    inset 0 0 0 0.5px rgb(0 0 0 / 0.35);
  opacity: 0.62;
  pointer-events: none;
`;

const Meter__Fill = styled.div<{
  $tone: StatTone;
  $fillColor?: string;
  $held: boolean;
}>`
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width var(--duration-slow) var(--ease-standard);
  /* A held reading dims the fill, not the hue and not the whole meter, so the label and figure stay readable. */
  ${({ $held }) => ($held ? "opacity: 0.55;" : "")}
  /* $fillColor is an arbitrary CSS colour and wins outright over the tone fill. */
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
