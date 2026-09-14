import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import type { ReactNode } from "react";
import styled from "styled-components";
import { MicroscopeIcon, StarIcon } from "./Icons";
import { NULL_DISPLAY } from "./NullValue";
/*
 * The badge's own vocabulary, reused rather than mirrored: `StaleGrade` is a
 * subset of `StreamStatusValue`, so a stale reading's grade goes straight in
 * and a number cannot use a different word from the badge captioning its panel.
 */
import { formatStreamStatus } from "./StreamStatusBadge";
/*
 * The hue the whole app already reads as "this is not current": the
 * `StreamStatusBadge` in the panel header paints its warning pill from the same
 * function, so the dot on the cell and the pill above it cannot drift apart.
 */
import { severityDotColor } from "./status/severityDotColor";
import { useSharedFormat } from "./UnitSharedFormat";
import {
  ATTACHED_SYMBOLS,
  displaySymbol,
  type FormatQuantityOptions,
  type FormatsFor,
  formatQuantity,
  kindOfUnit,
  type PresentableAs,
  wordForSymbol,
} from "./units";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * A quantity, rendered whole.
 *
 * ```tsx
 * <Unit value={altitude} />
 * ```
 *
 * That is the entire public surface for showing a quantity. The VALUE carries
 * its own unit, so the call site names neither the unit nor the format, and
 * every decision about how it looks and how it is spoken lives here.
 *
 * Taking value and unit as two props makes the call site restate what the
 * model already knows: every wire field carries a declared unit, and that
 * declaration is the field's TYPE. Nor is this opt-in, which is the
 * inconsistency it exists to end.
 *
 * ## An absent reading is stated, not left blank
 *
 * A value that has not arrived and one that is explicitly inapplicable both
 * render `NULL_DISPLAY`, so nothing this component is handed comes out as empty
 * space. Blank is the one output a reader cannot interpret: it reads equally as
 * a row that does not apply, as a label still waiting, and as a reading of
 * nothing, and the last of those is the dangerous one. A magnitude of zero is a
 * reading and keeps its zero.
 *
 * This is also why a call site needs no absence gate of its own: handing a read
 * straight over is correct as written, and coalescing it to `null` first says
 * the same thing twice.
 *
 * ## A reading that is not current says so, in THREE treatments and not ten
 *
 * Hand it a `Reading<Value<U>>` instead of a bare `Value<U>` and it also draws
 * whether the number is a reading of NOW. `Reading` is five states across two
 * reckoning arms; this draws three things, because the rest are distinctions an
 * operator cannot act on from a single number:
 *
 * - **current** (`observed`, either reckoning). Drawn exactly as a bare `Value`
 *   is, with no mark at all. A healthy reading adds nothing to the screen, for
 *   the reason `formatStreamStatus` returns `null` for `live`: a decoration
 *   present in the normal case is one the operator stops seeing
 * - **no number** (`pending`, `unowned`, `absent`). All three render the null
 *   token, which is what a bare `null` has always rendered. They differ in WHY
 *   there is no number, and an operator reading one cell cannot act on the
 *   difference: the answer is the same either way, look elsewhere. Naming them
 *   apart would also mean inventing a word for `pending` and one for `unowned`,
 *   where `absent` already has one in the panel badge
 * - **not current** (`stale`, any grade, either reckoning). The last real
 *   observation, drawn in full and MARKED. It is still the best number
 *   available and a reader must be able to read it
 *
 * The four {@link StaleGrade}s are one treatment and not four, for the same
 * reason. WHY a reading stopped being current is a channel-wide or link-wide
 * fact that already has a home in the panel's `StreamStatusBadge`, and four
 * glyph vocabularies inside a table would say it once per cell. The grade is
 * not thrown away though: it is the badge's own caption, said into the
 * accessibility tree and shown on hover, so the number and the badge above it
 * use one word for one fact.
 *
 * ## The mark is a SHAPE first, and takes up none of the value's room
 *
 * A dot at superscript height, just past the value, in the same warning hue the
 * panel's `StreamStatusBadge` paints. Three constraints shape it:
 *
 * - **it must not change the width.** A prefix or a suffix glyph IN THE FLOW
 *   reflows a table column every time a channel goes quiet, which is the
 *   loudest possible way to say something quiet, and it is why this was an
 *   underline first. The dot is absolutely positioned against the quantity, so
 *   it occupies no line box and the column measures the same to the pixel
 *   whether or not it is there
 * - **shape carries the meaning, colour only reinforces it.** WCAG 1.4.1: the
 *   dot is there or it is not, which a reader who cannot separate amber from
 *   grey still reads, and the hover and the spoken caption say it in words for
 *   one who cannot see it at all. The hue comes from `severityDotColor`, not
 *   from a literal, so the mark on the cell and the pill above it are one fact
 *   in one colour rather than two hand-typed ones drifting apart
 * - **it must not shout.** A stale value is the best number available, not a
 *   fault. A dot at 0.3em is readable when looked for and ignorable when not
 *
 * The hue is the one thing here that is NOT `currentColor`, unlike the unit
 * symbol beside it. A symbol is part of the quantity and must keep the tone the
 * caller gave it; the mark is a statement ABOUT the quantity, and a red alert
 * readout whose staleness mark was also red would be saying two things in one
 * colour. Contrast on the dot is a non-text-UI question (3:1), which the
 * warning token clears on every app surface.
 *
 * It is deliberately NOT a live region. `<Unit>` is the most-instanced
 * primitive in the app, and announcing every cell that went stale is how a
 * screen reader is made useless. A widget that wants the change announced wraps
 * its readout in `role="status"`, which several already do.
 *
 * ## The dot says WHETHER, the hover says WHEN
 *
 * How stale a reading is is most of what staleness means, so the component
 * answers it: the hover and the spoken caption carry the grade and the instant
 * the number was last a reading of now, formatted from the reading's own
 * `asOfUt` on the game's own calendar.
 *
 * Two levels rather than one, because a date in every cell is a date nobody
 * reads and a wall of them is unscannable. Present on demand, absent from the
 * glance. A widget that wants the AGE on screen still renders it as a caption
 * with a `<Unit>` of its own, which several do, and this does not duplicate it.
 *
 * It never draws a RECKONED figure. A modelled number replacing an
 * observed one has to be a written choice at the call site (see
 * `withoutReckoning`), and a primitive doing it silently at 373 call sites is
 * exactly the substitution `Reading` exists to prevent. A widget that wants the
 * model hands `reckoned.value` over as the `Value` it is.
 *
 * ## The legacy symbol form
 *
 * Passing a token as CHILDREN still renders a bare symbol, and is
 * TRANSITIONAL. It is what every call site used before values carried their
 * units, and it goes when the last of them is converted. Do not reach for it
 * in new code: a unit with no number beside it is the shape that let a readout
 * show a value with no unit at all.
 *
 * Hand it the token the contract declares (`m`, `kW`, `funds`) and it resolves
 * the rest: `units.ts` says what to display, whether that display is an icon,
 * and what the thing is called out loud. A rung symbol (`km`, `MW`) works
 * equally well, since that is what a laddered value hands back.
 *
 * That resolution is the point, and it covers currency too: funds, science and
 * reputation are three kinds the model already knows, with display symbols it
 * already carries, so they need no component of their own. Two places deciding
 * how a unit looks is exactly the duplication this package exists to remove.
 *
 * ## Sized and dimmed RELATIVE to the text it sits in
 *
 * The component exists so the concept has one name and one place to change,
 * and it is implemented relatively so it needs no size or tone prop and
 * composes into anything. Dropped into a 32px `BigReadout` it renders
 * proportionally large; dropped into an 11px table cell it renders
 * proportionally small. A version with absolute token sizes would need a prop
 * at every call site, and would be wrong at the extremes of the type scale.
 *
 * ## Why opacity rather than a colour token
 *
 * `--color-text-muted` would be wrong here. A value carries TONE: an alert
 * readout is red, a go readout is green, a stale one is dim. A fixed grey
 * symbol beside a red number reads as two separate things rather than one
 * quantity. `opacity` dims whatever colour it inherits, so the symbol stays the
 * value's own colour, just quieter.
 *
 * ## Why both are capped
 *
 * Relative alone breaks at the ends.
 *
 * - **Size** floors at 10px. `--font-size-xs` is 11px, so an uncapped 0.72em
 *   inside a caption would render at 8px, below what this UI is legible at.
 * - **Dimming** stops at 0.72. The theme's body text is already near the 4.5:1
 *   contrast floor, and dimming compounds with whatever the parent already did,
 *   so a symbol that keeps halving eventually fails WCAG on a surface that
 *   passed. Anything quieter is not a unit any more, it is decoration.
 *
 * ## Plane angles attach, and do not shrink
 *
 * SI leaves a space between a number and its unit, with exactly one class of
 * exception: the plane-angle symbols are written hard against the number,
 * "22°" and not "22 °". `°C` is NOT in that class and takes the normal space,
 * which is the distinction this handles.
 *
 * They also keep full size. A glyph like the degree sign sits at cap height, so
 * it is positioned relative to ITS OWN font size: shrink it and it drops toward
 * the middle of the number beside it, which is what shrinking every symbol
 * alike looked like. Full size keeps it where the reader expects it.
 *
 * ## The word is not optional
 *
 * A symbol is written for the eye. A screen reader announces `km` as "kay em",
 * the degree sign as nothing whatsoever, and an icon as nothing at all, since
 * lucide and this package's icon wrapper both mark it `aria-hidden`. So every
 * unit renders its word from `wordForSymbol` into the accessibility tree
 * beside the symbol, and a readout that shows a unit announces one.
 *
 * The alternative is a convention that the enclosing readout carries an
 * `aria-label` spelling the unit out, and it does not survive contact: across
 * the whole app exactly one hand-written place honoured it, while the rest
 * interpolated the formatted string and so announced the symbol anyway. A rule
 * kept in one component beats a rule every call site has to remember.
 */

// The attach rule lives in `./units` so this component and `writeQuantity`
// cannot disagree about it. See ATTACHED_SYMBOLS for why.
const ATTACHED = ATTACHED_SYMBOLS;

/**
 * Kinds shown as a glyph rather than as text, chosen from a rendered trial:
 * science takes a microscope and reputation a star, both close to their
 * in-game icons. Funds keeps its `f`, which is the game's own convention and
 * already what every funds readout showed.
 *
 * Keyed on the DISPLAYED symbol, so it lines up with the word table.
 */
const ICON_BY_SYMBOL = {
  sci: MicroscopeIcon,
  rep: StarIcon,
} as const;

const Unit__Span = styled.span<{ $attached: boolean; $icon: boolean }>`
  /* Relative to the parent's font size, with a floor. Attached symbols keep
     full size: see the header on why shrinking drops them off their line.

     Icons take 0.9em rather than 0.72em. lucide draws on a 24-unit grid at
     stroke 1.8, so at 0.72 of a 10px readout the effective stroke falls under
     one device pixel and the microscope in particular stops being legible. */
  font-size: ${({ $attached, $icon }) =>
    $attached ? "1em" : $icon ? "0.9em" : "max(0.72em, 10px)"};
  /* Dims whatever colour it inherits, so the symbol keeps the value's tone.
     Attached symbols are exempt: a plane angle is part of the number's own
     typography rather than a unit token beside it, so dimming it detaches it
     from the value it belongs to. Icons are exempt for the same reason a thin
     stroke needed the size bump: dimming a 1.8-unit stroke erases it. */
  opacity: ${({ $attached, $icon }) => ($attached || $icon ? "1" : "0.72")};
  /* No margin here on purpose. The gap between a number and its unit is a real
     THIN SPACE character in the markup instead, because a margin is invisible
     to the clipboard and copying a readout yielded "12.4km". The character
     copies as the space a reader expects, and the line-break protection the
     margin was standing in for comes from nowrap on the wrapper. */
  /* "m/s" and "kg/m³" must never wrap mid-symbol. */
  white-space: nowrap;
  /* A unit is not a word: it must survive a parent that uppercases its text,
     because m and M are metre and mega. This already bit the Graph header. */
  text-transform: none;
  /* A glyph is centred on the DIGITS beside it, not sat on their baseline.
     An inline-flex box holding a replaced element has no baseline of its own,
     so the box's bottom edge becomes one and the icon sits from the baseline
     upwards: its own centre lands half a glyph-box above, where the digits'
     centre is only half a cap-height above, and the star read as floating.
     Measured on the Strategies rep chip at 12px: cap height 17 device px,
     glyph box 21.6, the star's centre 3 px high. That is the offset below, in
     em so it holds at every readout size. */
  ${({ $icon }) =>
    $icon
      ? "display: inline-flex; align-items: center; vertical-align: -0.12em;"
      : ""}
`;

/*
 * The not-current mark: a dot at superscript height, just past the value.
 *
 * ABSOLUTELY POSITIONED, and that is the whole reason a glyph is allowed here
 * at all. An out-of-flow box contributes nothing to the line, so the value
 * occupies exactly what it occupied before and a column of them cannot reflow
 * when one channel goes quiet. Measured rather than argued, by
 * `scripts/render-unit-currency.ts`: a four-column `DataTable` of 24 `<Unit>`
 * cells, nine of them marked, sized to content in chromium. Marked and unmarked
 * come back identical to the hundredth of a pixel (table 346.92px, speed column
 * 84.66px). The same dot IN THE FLOW takes that table to 353.64px and the speed
 * column to 90.33px, a 6.7% column move on a fact the operator cannot act on,
 * and that third table is the ruler's control: a measurement that cannot see a
 * reflow reports none, so the harness plants one and fails if it goes unseen.
 *
 * `left: 100%` reads off the containing block, which is the relatively
 * positioned quantity beside it, so the dot follows the value's own right edge
 * however wide the number is. `top: 0` is the top of that inline box, which is
 * the font's ascent: superscript height without an actual `<sup>`, whose
 * `font-size` change would have to be undone for a box with no text in it.
 *
 * Sized in `em` with a pixel floor, for the same reason the unit symbol is: an
 * uncapped 0.3em in an 11px caption lands under 4px, which is a smudge rather
 * than a dot. The hue is `severityDotColor`'s, not a literal, so the cell and
 * the `StreamStatusBadge` above it paint one fact in one colour.
 */
const Unit__NotCurrentMark = styled.span`
  position: absolute;
  left: 100%;
  top: 0;
  width: max(0.3em, 4px);
  height: max(0.3em, 4px);
  margin-left: 0.14em;
  border-radius: var(--radius-circle);
  background: ${severityDotColor("warning")};
`;

/* Wraps a number and its unit so neither the thin space between them nor a
   compound symbol can be split across a line. Relatively positioned when it
   carries a mark, which is what gives the dot above something to hang off; the
   `nowrap` is what makes that box a single rectangle to hang off. */
const Unit__Quantity = styled.span<{ $notCurrent: boolean }>`
  white-space: nowrap;
  ${({ $notCurrent }) => ($notCurrent ? "position: relative;" : "")}
`;

/* The staleness caption, for the accessibility tree and the clipboard's
   exclusion list, on the same terms as the spoken unit word above: it is a
   reading of the mark beside it rather than extra content, so copying a readout
   must not pick it up. */
const Unit__Currency = styled(VisuallyHidden)`
  user-select: none;
`;

/* The spoken word, for the accessibility tree only. Excluded from selection so
   copying "12.4 km" does not also yield "kilometres": the word is a reading of
   the symbol beside it, not extra content. */
const Unit__Word = styled(VisuallyHidden)`
  user-select: none;
`;

/** U+2009 THIN SPACE. SI puts a space between a number and its unit. */
const THIN_SPACE = "\u2009";

/**
 * What `<Unit value>` accepts: the quantity on its own, or a whole `Reading` of
 * it.
 *
 * A WIDENING rather than a replacement, and that is the whole shape of the
 * migration. The two are structurally distinguishable (`Reading` has a `state`,
 * a `Value` has a magnitude and a unit), so every call site written against the
 * narrow form keeps compiling and keeps rendering identically, and a call site
 * converts by handing over what it already holds instead of unwrapping it
 * first.
 */
export type UnitValue<U extends string = string> = Value<U> | Reading<Value<U>>;

/** What {@link resolveCurrency} answers: the number to draw, and its currency. */
interface Resolved<U extends string> {
  shown: Value<U> | null | undefined;
  /** Whether the number on screen is a reading of now. Drives the mark. */
  notCurrent: boolean;
  /**
   * The grade's caption and, where the reading carries a readable instant, when
   * the number was last a reading of now. Said rather than shown, and null when
   * there is nothing to say.
   */
  caption: string | null;
}

/**
 * When the observation was made, on the game's own calendar, or null when the
 * reading carries no readable instant.
 *
 * Through `formatQuantity` rather than around it, so a held number and a
 * `<MissionDate>` beside it cannot print two spellings of one UT: the universal
 * time branch there delegates to `formatKspDate`, which reads whichever
 * calendar the running game reported. A malformed or non-finite `asOfUt` comes
 * back as `NULL_DISPLAY`, and answers null here instead: an "as of" followed by
 * the null token is worse than the grade on its own.
 */
function lastValidAt(asOfUt: Value<"ut"> | undefined): string | null {
  if (asOfUt === undefined) return null;
  const { value } = formatQuantity(asOfUt.magnitude, asOfUt.unit);
  return value === NULL_DISPLAY ? null : value;
}

/**
 * What the mark says in words: the grade, and how far back the number is from.
 *
 * Two levels, and the split is the operator ruling that shaped this. HOW stale
 * a reading is is most of what staleness means, and a glance at a wall of cells
 * is not where it belongs: a date in every cell is a date nobody reads. So the
 * dot answers the yes-or-no question at a glance, and this answers the
 * follow-up on demand, in the hover and in the accessibility tree.
 *
 * The grade word is `formatStreamStatus`'s and is never rephrased here.
 */
function sayCurrency(
  caption: string | null,
  asOfUt: Value<"ut"> | undefined,
): string | null {
  if (caption === null) return null;
  const at = lastValidAt(asOfUt);
  return at === null ? caption : `${caption}, as of ${at}`;
}

/**
 * Split what was handed in into the number and the statement about it.
 *
 * A bare `Value` (and `null`, and nothing at all) is current by construction:
 * it carries no currency, so there is nothing to say and nothing to draw, which
 * is what keeps the unconverted call sites byte-identical.
 *
 * `notCurrent` and `caption` are two fields rather than one nullable string on
 * purpose. `formatStreamStatus` answers `null` for `live` alone, which is not a
 * `StaleGrade` and so cannot arrive here, but deriving the MARK from the
 * caption would make an unmarked stale number the failure mode if that ever
 * stopped being true. The mark comes off the state, where it belongs.
 */
function resolveCurrency<U extends string>(
  input: UnitValue<U> | null | undefined,
): Resolved<U> {
  /*
   * `in` throws on a primitive, and a bare number reaches this prop: several
   * callers hand over a raw magnitude rather than a `Value`, which the old
   * signature tolerated and which the widened one must keep tolerating. Guard
   * the discriminator on the type rather than trusting the declared union.
   */
  if (typeof input !== "object" || input === null || !("state" in input)) {
    return { shown: input, notCurrent: false, caption: null };
  }
  if (input.state === "observed") {
    return { shown: input.value, notCurrent: false, caption: null };
  }
  if (input.state === "stale") {
    return {
      shown: input.value,
      notCurrent: true,
      caption: sayCurrency(formatStreamStatus(input.grade), input.asOfUt),
    };
  }
  /*
   * pending, unowned and absent, which carry no number between them. `null`
   * rather than `undefined`, so the branch below still takes the value path
   * and renders the null token instead of falling through to the symbol form.
   */
  return { shown: null, notCurrent: false, caption: null };
}

export interface UnitProps<U extends string = string>
  extends Omit<FormatQuantityOptions, "format" | "as"> {
  /**
   * The quantity to show. It carries its own unit, so nothing else needs to be
   * passed and nothing else can disagree with it.
   *
   * Absent or null, it renders the null token, so a call site may hand a read
   * straight over without a gate of its own and still say something true. A
   * magnitude of zero is a reading and renders as a zero.
   *
   * Hand it the whole {@link Reading} instead and it also draws whether the
   * number is current: see the header on the three treatments and why there are
   * three.
   */
  value?: UnitValue<U> | null;
  /**
   * Pin the unit rather than letting the ladder choose, for the cases where
   * convention beats magnitude: km/h on a launch broadcast, km/s in a
   * technical readout.
   *
   * Validated against the value's KIND, so this checks on a speed and is a
   * type error on a length. That check is why the value's unit reaches the
   * type system at all.
   */
  format?: FormatsFor<U>;
  /**
   * Show the value in a different unit of the same kind: `as="°C"` on a kelvin
   * field, `as="g"` on an m/s² one. The contract says what the field IS, this
   * says what the operator wants to READ.
   *
   * Validated against the value's KIND, exactly as `format` is. A cross-kind
   * request is refused by the formatter at runtime and the value renders in its
   * own unit, so an untyped `as` was a prop that silently did nothing.
   */
  as?: PresentableAs<U>;
  /**
   * TRANSITIONAL: a bare unit token, rendered as a symbol with no number.
   *
   * Every call site used this before values carried their units. It goes when
   * the last one is converted; new code passes a value.
   */
  children?: ReactNode;
  className?: string;
}

/**
 * The symbol half: the glyph or icon, plus the word that replaces it in the
 * accessibility tree.
 *
 * Split out because both forms below share it, and rendered with a leading
 * thin space only when there is a number in front of it to be spaced from.
 */
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

  // The category kinds (count, id, text, flag, enum, n/a) display as an empty
  // string on purpose: they name what a field IS rather than what it is
  // measured in, and "3 count" is not a readout. Nothing to render, and
  // nothing to announce either.
  if (symbol === "") return null;

  const word = wordForSymbol(symbol);
  const Glyph = ICON_BY_SYMBOL[symbol as keyof typeof ICON_BY_SYMBOL];
  const attached = ATTACHED.has(symbol);

  // The word REPLACES the symbol in the accessibility tree rather than joining
  // it. A symbol left announceable next to its own word reads as "kay em
  // kilometres", and the currencies were worse: "twelve thousand four hundred
  // and fifty f funds". So the visible symbol is hidden exactly when there is
  // a word to say instead.
  //
  // A symbol with no word stays announced. That is the one case where an
  // awkward "kay em" beats the alternative, which is the unit vanishing from
  // the readout entirely. It is also the signal that WORD_BY_SYMBOL is missing
  // an entry rather than that the unit is unannounceable.
  const spoken = word !== undefined;

  return (
    <>
      {spaced && !attached ? THIN_SPACE : null}
      <Unit__Span
        $attached={attached}
        $icon={Glyph !== undefined}
        className={className}
        data-unit={token}
        // Disambiguates two units that share a glyph, for a reader who cannot
        // hear the accessible name. A mod may mean grams by "g" where the
        // first-party catalog means g-force; both render "g" and the tooltip
        // says which. Colour was considered and rejected: WCAG 1.4.1 forbids
        // it as the sole carrier of meaning, and a hashed kind-colour is
        // unlearnable anyway.
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

export function Unit<U extends string = string>({
  value,
  children,
  className,
  ...opts
}: UnitProps<U>) {
  // Unpacked first, so the number and the statement about it go separate ways.
  // Everything below works on `shown`, the `Value` the narrow prop carried.
  const { shown, notCurrent, caption } = resolveCurrency(value);
  // Reports this quantity to an enclosing `<UnitSharedFormat>` and comes back
  // with the format the group settled on, so two Units drawing two ends of one
  // interval cannot land on different rungs or on digit counts that hide the
  // width between them. Inert with no scope above it, which is every existing
  // call site: the ladder answers per value exactly as before.
  //
  // APPLYING it is this component's job and only this component's. A caller
  // that read the group's answer and passed it back down as a prop would be a
  // second formatter standing beside the one formatter.
  //
  // A stale member reports exactly as a live one does, and must. A column whose
  // rung moved when one cell stopped updating would rewrite all the others.
  // The number is still a real number on the same ladder, which is the whole of
  // what a report carries.
  const shared = useSharedFormat(shown, opts);

  // An absent value renders through here too, and comes out as the null token.
  // A reading that has not arrived and one that is explicitly inapplicable owe
  // the reader the same statement, that there is no number here, and neither
  // may be told by leaving the space empty. The only way past this branch is to
  // hand a bare symbol as children, which a call site does deliberately.
  if (value !== undefined || children === undefined) {
    /*
     * The group's answer goes UNDER this call site's own props, never over
     * them. An absent field is a group with no opinion; a field the caller also
     * named is a caller who pinned it, and a pin is the standing escape.
     *
     * Below, formatted.symbol and NOT formatted.rung. They agree on a laddered
     * value and differ exactly where it matters: a duration comes back with its
     * parts interleaved into the value ("2h 14m") and an EMPTY symbol, while
     * its rung is still "s", so rendering the rung would print a stray "s"
     * beside a formatted duration. An absent value is the same shape, and
     * renders no unit rather than a unit beside the null token.
     */
    const formatted = formatQuantity(
      shown?.magnitude,
      shown?.unit,
      shared === undefined ? opts : { ...shared, ...opts },
    );
    return (
      <Unit__Quantity
        className={className}
        $notCurrent={notCurrent}
        // Greppable, and what a test asserts on.
        data-not-current={notCurrent ? "" : undefined}
        // Hover says in words what the dot says in shape, and adds the instant
        // the dot has no room for, for a sighted reader who has no badge in
        // view. The symbol carries its own title (the unit word) and keeps it:
        // hovering the digits answers the mark, hovering the symbol answers the
        // unit.
        title={caption ?? undefined}
      >
        {formatted.value}
        <UnitSymbol token={formatted.symbol} spaced />
        {/* Silent: it has no text, and a bullet announced on every held cell
            would bury the caption below that actually says something. What it
            carries instead is SHAPE, present or absent, so the meaning does not
            rest on telling amber from grey (WCAG 1.4.1). */}
        {notCurrent && (
          <Unit__NotCurrentMark aria-hidden="true" data-not-current-mark="" />
        )}
        {caption !== null && (
          <Unit__Currency data-unit-currency="">, {caption}</Unit__Currency>
        )}
      </Unit__Quantity>
    );
  }

  // A non-string child cannot be looked up, so it renders as given. Kept so
  // the component still composes with an interpolated node rather than
  // throwing at a call site that has a good reason.
  if (typeof children !== "string") {
    return (
      <Unit__Span $attached={false} $icon={false} className={className}>
        {children}
      </Unit__Span>
    );
  }

  return <UnitSymbol token={children} className={className} spaced={false} />;
}
