import type { Reading, Value } from "@ksp-gonogo/sitrep-sdk";
import type { ReactNode } from "react";
import styled, { css } from "styled-components";
import { MicroscopeIcon, StarIcon } from "./Icons";
/*
 * The badge's own vocabulary, reused rather than mirrored: `StaleGrade` is a
 * subset of `StreamStatusValue`, so a stale reading's grade goes straight in
 * and a number cannot use a different word from the badge captioning its panel.
 */
import { formatStreamStatus } from "./StreamStatusBadge";
import { useSharedRung } from "./UnitScale";
import {
  ATTACHED_SYMBOLS,
  displaySymbol,
  type FormatQuantityOptions,
  type FormatsFor,
  formatQuantity,
  kindOfUnit,
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
 * ## The mark is a SHAPE, never a tone, and never a glyph beside the number
 *
 * A dotted underline, in whatever colour the value already has. Three
 * constraints leave very little else:
 *
 * - **tone belongs to the caller.** An alert readout is red and a go readout is
 *   green (see "Why opacity rather than a colour token" below); a component that
 *   dimmed on its own would compound with a caller that had already dimmed, and
 *   the dimming floor exists because the theme's body text is near the contrast
 *   minimum to start with. `currentColor` keeps the mark on whatever tone the
 *   caller chose, and WCAG 1.4.1 rules out colour as the sole carrier anyway
 * - **it must not change the width.** A prefix or a suffix glyph would reflow a
 *   table column every time a channel went quiet, which is the loudest possible
 *   way to say something quiet. An underline occupies no line box
 * - **it must not shout.** A stale value is the best number available, not a
 *   fault. Dots under it are readable when looked for and ignorable when not
 *
 * It is deliberately NOT a live region. `<Unit>` is the most-instanced
 * primitive in the app, and announcing every cell that went stale is how a
 * screen reader is made useless. A widget that wants the change announced wraps
 * its readout in `role="status"`, which several already do.
 *
 * ## What the mark does NOT say, and does not try to
 *
 * How OLD the observation is. `asOfUt` is on the reading and the age is a
 * number in its own right, so a widget that wants to show it renders it as a
 * caption with a `<Unit>` of its own. The mark answers the yes-or-no question
 * every readout has, and leaves the quantity to a readout that has room for it.
 *
 * It also never draws a RECKONED figure. A modelled number replacing an
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

/* The not-current mark. Longhands rather than the shorthand so the offset is
   not reset by it, and currentColor (the default decoration colour) is what
   keeps the mark on the value's own tone. Thickness has a pixel floor for the
   same reason the symbol's size does: from-font lands under one device pixel in
   a caption and the dots disappear. */
const NOT_CURRENT = css`
  text-decoration-line: underline;
  text-decoration-style: dotted;
  text-decoration-thickness: max(1px, 0.05em);
  text-underline-offset: 0.22em;
`;

/* Wraps a number and its unit so neither the thin space between them nor a
   compound symbol can be split across a line. */
const Unit__Quantity = styled.span<{ $notCurrent: boolean }>`
  white-space: nowrap;
  ${({ $notCurrent }) => ($notCurrent ? NOT_CURRENT : null)}
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
  /** The grade's caption, said rather than shown, or null when there is none. */
  caption: string | null;
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
      caption: formatStreamStatus(input.grade),
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
  extends Omit<FormatQuantityOptions, "format"> {
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
  // Reports this quantity to an enclosing `<UnitScale>` and comes back with the
  // rung the group settled on, so two Units drawing two ends of one interval
  // cannot land on different rungs. Inert with no scope above it, which is
  // every existing call site: the ladder answers per value exactly as before.
  //
  // A stale member reports exactly as a live one does, and must. A column whose
  // rung moved when one cell stopped updating would rewrite all the others.
  // The number is still a real number on the same ladder, which is the whole of
  // what a report carries.
  const shared = useSharedRung(shown, opts);

  // An absent value renders through here too, and comes out as the null token.
  // A reading that has not arrived and one that is explicitly inapplicable owe
  // the reader the same statement, that there is no number here, and neither
  // may be told by leaving the space empty. The only way past this branch is to
  // hand a bare symbol as children, which a call site does deliberately.
  if (value !== undefined || children === undefined) {
    // formatted.symbol, NOT formatted.rung. They agree on a laddered value and
    // differ exactly where it matters: a duration comes back with its parts
    // interleaved into the value ("2h 14m") and an EMPTY symbol, while its
    // rung is still "s", so rendering the rung would print a stray "s" beside
    // a formatted duration. An absent value is the same shape, and renders no
    // unit rather than a unit beside the null token.
    const formatted = formatQuantity(
      shown?.magnitude,
      shown?.unit,
      shared === undefined ? opts : { ...opts, format: shared },
    );
    return (
      <Unit__Quantity
        className={className}
        $notCurrent={notCurrent}
        // Greppable, and what a test asserts on. The mark itself is a CSS
        // decoration, which jsdom reads off the emitted rule and not the node.
        data-not-current={notCurrent ? "" : undefined}
        // Hover says in words what the dots say in shape, for a sighted reader
        // who has no badge in view. The symbol carries its own title (the unit
        // word) and keeps it: hovering the digits answers the mark, hovering
        // the symbol answers the unit.
        title={caption ?? undefined}
      >
        {formatted.value}
        <UnitSymbol token={formatted.symbol} spaced />
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
