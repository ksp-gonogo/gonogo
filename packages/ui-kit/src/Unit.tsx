import {
  type BandKind,
  bandIn,
  value as quantity,
  type Reading,
  type UncertaintyBand,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import type { ReactNode } from "react";
import styled from "styled-components";
import { bandClaim } from "./bandClaim";
import { MicroscopeIcon, StarIcon } from "./Icons";
import { NotCurrentMark } from "./NotCurrentMark";
import { resolveCurrency, type UnitValue } from "./readingCurrency";
import { severityDotColor } from "./status/severityDotColor";
import { useInSharedFormat, useSharedFormat } from "./UnitSharedFormat";
import {
  ATTACHED_SYMBOLS,
  displaySymbol,
  type FormatQuantityOptions,
  type FormatsFor,
  formatQuantity,
  kindOfUnit,
  type PresentableAs,
  readsAsOneFigure,
  speakQuantity,
  wordForSymbol,
} from "./units";
import { VisuallyHidden } from "./VisuallyHidden";

const ATTACHED = ATTACHED_SYMBOLS;

/** Kinds shown as a glyph rather than text, keyed on the displayed symbol. Funds keeps its `f`, the game's own convention. */
const ICON_BY_SYMBOL = {
  sci: MicroscopeIcon,
  rep: StarIcon,
} as const;

const Unit__Span = styled.span<{ $attached: boolean; $icon: boolean }>`
  /* Relative to the parent's font size with a floor; attached symbols keep full size, and icons take 0.9em so a thin stroke stays legible. */
  font-size: ${({ $attached, $icon }) =>
    $attached ? "1em" : $icon ? "0.9em" : "max(0.72em, 10px)"};
  /* Dims the inherited colour so the symbol keeps the value's tone; attached symbols and icons are exempt. */
  opacity: ${({ $attached, $icon }) => ($attached || $icon ? "1" : "0.72")};
  /* No margin: the number-unit gap is a thin space character in the markup, so it survives copying. */
  /* "m/s" and "kg/m³" must never wrap mid-symbol. */
  white-space: nowrap;
  /* A unit must survive an uppercasing parent: m and M are metre and mega. */
  text-transform: none;
  /* A glyph centres on the digits beside it rather than sitting on their baseline; the offset is in em so it holds at every size. */
  ${({ $icon }) =>
    $icon
      ? "display: inline-flex; align-items: center; vertical-align: -0.12em;"
      : ""}
`;

// Relatively positioned when it carries a mark, so the out-of-flow dot hangs off the value's own box and never reflows a column.
const Unit__Quantity = styled.span<{ $notCurrent: boolean }>`
  white-space: nowrap;
  ${({ $notCurrent }) => ($notCurrent ? "position: relative;" : "")}
`;

// Dimmer than the value but never smaller: a qualifier must recede without becoming unreadable.
const Unit__Interval = styled.span`
  color: var(--color-text-muted);
  white-space: nowrap;
`;

// The spoken staleness caption, excluded from selection so copying a readout does not pick it up.
const Unit__Currency = styled(VisuallyHidden)`
  user-select: none;
`;

// The spoken unit word, excluded from selection so copying "12.4 km" does not also yield "kilometres".
const Unit__Word = styled(VisuallyHidden)`
  user-select: none;
`;

export type { UnitValue } from "./readingCurrency";

/** U+2009 THIN SPACE. SI puts a space between a number and its unit. */
const THIN_SPACE = "\u2009";

/**
 * The model's interval, written against the figure on screen at the value's own rung, so it never prints as `1 km ± 25 m`.
 *
 * `±` is used only where the two half-widths agree to the precision shown and the band's value is the figure being drawn, since `±` reads as an offset from the number beside it. Otherwise the range form prints the model's own two ends.
 */
function toInterval<U extends string>(
  shown: Value<U>,
  band: UncertaintyBand<U> | undefined,
  opts: FormatQuantityOptions,
  rung: string,
): Interval | null {
  if (band === undefined) return null;
  const write = <W extends string>(quantity: Value<W>): string =>
    formatQuantity(quantity.magnitude, quantity.unit, {
      ...opts,
      format: rung,
    }).value;
  const width = (from: Value<U>, to: Value<U>): string => write(to.minus(from));
  // Ends that print as the same text draw as one approximate figure, by the same test `<Band>` uses; if that figure is the one on screen the interval adds nothing.
  const oneFigure = readsAsOneFigure([band.lo, band.hi], {
    ...opts,
    format: rung,
  });
  if (oneFigure && write(band.lo) === write(shown)) return null;
  const below = width(band.lo, band.value);
  const above = width(band.value, band.hi);
  const anchored = write(band.value) === write(shown);
  // The spoken ends carry the unit's word; the written ends carry no symbol because one `<UnitSymbol>` follows the pair.
  const spoken = { ...opts, format: rung };
  return {
    oneFigure,
    plusMinus: !oneFigure && anchored && below === above ? above : null,
    lo: write(band.lo),
    hi: write(band.hi),
    loSaid: speakQuantity(band.lo, spoken),
    hiSaid: speakQuantity(band.hi, spoken),
    kind: band.kind,
  };
}

/** The interval as it is written and as it is qualified. See {@link toInterval}. */
interface Interval {
  /** Whether both ends print as the same text, so only `lo` is drawn. */
  oneFigure: boolean;
  /** The half-width, where the short form is honest, and null where it is not. */
  plusMinus: string | null;
  /** The low end for the eye: no symbol, since the pair shares one. */
  lo: string;
  hi: string;
  /** The low end for the ear, with the unit's WORD rather than its symbol. */
  loSaid: string;
  hiSaid: string;
  kind: BandKind;
}

/** The hover text: the staleness sentence, the band's claim (worded by `bandClaim`, as a meter's is), or both. */
function hover(
  caption: string | null,
  interval: Interval | null,
): string | null {
  const said =
    interval === null
      ? null
      : bandClaim(
          interval.kind,
          `with bands at ${interval.loSaid} and ${interval.hiSaid}`,
        );
  if (caption === null) return said;
  return said === null ? caption : `${caption}, ${said}`;
}

export interface UnitProps<U extends string = string>
  extends Omit<FormatQuantityOptions, "format" | "as"> {
  /**
   * The quantity to show; it carries its own unit. Absent or null renders the null token, so a read can be handed straight over without a gate; zero renders as zero.
   *
   * A whole {@link Reading} also draws whether the number is current.
   */
  value?: UnitValue<U> | null;
  /**
   * Pin the unit rather than letting the ladder choose, for the cases where
   * convention beats magnitude: km/h on a launch broadcast, km/s in a
   * technical readout.
   *
   * Validated against the value's kind: it checks on a speed and is a type error on a length.
   */
  format?: FormatsFor<U>;
  /**
   * Show the value in a different unit of the same kind: `as="°C"` on a kelvin
   * field, `as="g"` on an m/s² one. The contract says what the field IS, this
   * says what the operator wants to READ.
   *
   * Validated against the value's kind, as `format` is. A cross-kind request at runtime renders the value in its own unit.
   */
  as?: PresentableAs<U>;
  /**
   * Draw the number without its symbol, for a member of a group that prints the
   * symbol once at the end: `1234/2000 rpm` rather than `1234 rpm/2000 rpm`.
   *
   * Honoured only inside a `<UnitSharedFormat>`; on a lone `<Unit>` it does nothing, since a number with no unit near it is not a readout. The member still reports, so its magnitude keeps its vote on the group's rung. The symbol is hidden from the accessibility tree as well as the screen.
   */
  hideUnitInGroup?: boolean;
  /** Transitional: a bare unit token, rendered as a symbol with no number. New code passes a value. */
  children?: ReactNode;
  className?: string;
}

/** The symbol half: the glyph or icon, plus the word that replaces it in the accessibility tree. */
function UnitSymbol({
  token,
  className,
  spaced,
}: {
  token: string;
  className?: string;
  spaced: boolean;
}) {
  const symbol = displaySymbol(token, kindOfUnit(token));

  // Category kinds (count, id, text, flag, enum, n/a) display as an empty string: they name what a field is, not a unit.
  if (symbol === "") return null;

  const word = wordForSymbol(symbol);
  const Glyph = ICON_BY_SYMBOL[symbol as keyof typeof ICON_BY_SYMBOL];
  const attached = ATTACHED.has(symbol);

  // The word replaces the symbol in the accessibility tree; a symbol with no word stays announced rather than the unit vanishing.
  const spoken = word !== undefined;

  return (
    <>
      {spaced && !attached ? THIN_SPACE : null}
      <Unit__Span
        $attached={attached}
        $icon={Glyph !== undefined}
        className={className}
        data-unit={token}
        // Disambiguates units that share a glyph (a mod's grams against g-force) for a reader who cannot hear the accessible name.
        title={word}
      >
        {Glyph ? (
          <Glyph size="1em" />
        ) : spoken ? (
          <span aria-hidden="true">{symbol}</span>
        ) : (
          symbol
        )}
        {spoken && <Unit__Word data-unit-word=""> {word}</Unit__Word>}
      </Unit__Span>
    </>
  );
}

/**
 * A quantity, rendered whole: `<Unit value={altitude} />`. The value carries its own unit, so the call site names neither the unit nor the format.
 *
 * An absent or null value renders `NULL_DISPLAY`, never blank space, and a magnitude of zero keeps its zero.
 *
 * Handed a `Reading<Value<U>>`, it also draws whether the number is current, in three treatments:
 * - current (`observed`): drawn as a bare `Value` is, with no mark
 * - no number (`pending`, `unowned`, `absent`): the null token
 * - not current (`stale`, any grade): the last observation in full, marked by a dot at superscript height in the warning hue, with the grade and the `asOfUt` instant on hover and in the spoken caption
 *
 * The mark is out of flow, so a column never reflows when a channel goes quiet, and it is not a live region: a widget that wants the change announced wraps its readout in `role="status"`. It never draws a reckoned figure; a widget that wants the model hands `reckoning.modelled` over as the `Value` it is.
 *
 * A held reading whose model publishes an {@link UncertaintyBand} also shows the interval (`1 km ± 0.025 km`, `1 km (0.97 to 1.03 km)`, `1 km (~1.2 km)`). A current reading shows none, and a band in another unit draws nothing.
 *
 * The symbol is sized and dimmed relative to the text around it (floored at 10px, dimmed no further than 0.72 opacity) so it needs no size or tone prop and keeps the value's tone. Plane angles attach to the number and keep full size. Every symbol is replaced in the accessibility tree by its spoken word.
 */
export function Unit<U extends string = string>({
  value,
  children,
  className,
  // Kept out of `opts`, which goes to the formatter: this is about drawing, not the number.
  hideUnitInGroup,
  ...opts
}: UnitProps<U>) {
  const { shown, notCurrent, caption, band } = resolveCurrency(value);
  /*
   * Reports to an enclosing `<UnitSharedFormat>` and returns the format the group settled on; inert with no scope above it.
   * A stale member reports as a live one does, so a column's rung does not move when one cell stops updating.
   */
  const shared = useSharedFormat(shown, opts);

  // Membership, not `shared !== undefined`: a group over a unit with no ladder (`rpm`) settles nothing yet still hides the symbol.
  const inGroup = useInSharedFormat();
  const hideSymbol = hideUnitInGroup === true && inGroup;

  if (value !== undefined || children === undefined) {
    /*
     * The group's answer goes under this call site's own props, so a caller's pin wins.
     * Render `formatted.symbol`, never `formatted.rung`: a duration interleaves its parts into the value ("2h 14m") with an empty symbol while its rung is still "s".
     */
    const resolved = shared === undefined ? opts : { ...shared, ...opts };
    const formatted = formatQuantity(shown?.magnitude, shown?.unit, resolved);
    // Narrowed to the shown value's unit, never assumed: a band arrives keyed by a runtime path, and `bandIn` answers nothing rather than converting.
    const interval =
      shown == null || band === null || !notCurrent
        ? null
        : toInterval(shown, bandIn(band, shown.unit), resolved, formatted.rung);
    return (
      <Unit__Quantity
        className={className}
        $notCurrent={notCurrent}
        data-not-current={notCurrent ? "" : undefined}
        // The hover says in words what the dot says in shape, plus the instant and the band's claim; the symbol keeps its own title.
        title={hover(caption, interval) ?? undefined}
      >
        {formatted.value}
        {!hideSymbol && <UnitSymbol token={formatted.symbol} spaced />}
        {interval !== null && (
          <Unit__Interval data-unit-band="">
            {interval.oneFigure ? (
              <>
                {" ("}
                {/* The approximate mark is silent; the word beside it is spoken. */}
                <span aria-hidden="true">~</span>
                <Unit__Word data-unit-word="">approximately </Unit__Word>
                {interval.lo}
              </>
            ) : interval.plusMinus === null ? (
              ` (${interval.lo} to ${interval.hi}`
            ) : (
              ` ± ${interval.plusMinus}`
            )}
            {/* A band is in the figure's unit, so its symbol hides with the main one. */}
            {!hideSymbol && <UnitSymbol token={formatted.symbol} spaced />}
            {interval.plusMinus === null ? ")" : null}
          </Unit__Interval>
        )}
        {/* Silent: the caption below is what gets spoken, and the shape alone carries the meaning (WCAG 1.4.1). */}
        {notCurrent && (
          <NotCurrentMark aria-hidden="true" data-not-current-mark="" />
        )}
        {caption !== null && (
          <Unit__Currency data-unit-currency="">, {caption}</Unit__Currency>
        )}
      </Unit__Quantity>
    );
  }

  // A non-string child cannot be looked up, so it renders as given.
  if (typeof children !== "string") {
    return (
      <Unit__Span $attached={false} $icon={false} className={className}>
        {children}
      </Unit__Span>
    );
  }

  return <UnitSymbol token={children} className={className} spaced={false} />;
}
