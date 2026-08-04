import type { Value } from "@ksp-gonogo/sitrep-sdk";
import type { ReactNode } from "react";
import styled from "styled-components";
import { MicroscopeIcon, StarIcon } from "./Icons";
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
 * The previous shape was Quantity, taking value and unit as two props, which
 * made the call site restate what the model already knows: every wire field
 * carries a declared unit, and that declaration is now the field's TYPE. It
 * was also opt-in, which is the inconsistency this exists to end.
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
 * That resolution is the point. There used to be a separate `CurrencyUnit`
 * component holding the funds/science/reputation presentation, which was three
 * kinds the model already knew, with display symbols it already carried. Two
 * places deciding how a unit looks is exactly the duplication this package
 * exists to remove.
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
 * This replaces the convention the old version of this file DOCUMENTED, which
 * was that the enclosing readout should carry an `aria-label` spelling the unit
 * out. That convention was honoured in exactly one hand-written place across
 * the whole app; the other labels interpolated the formatted string and so
 * announced the symbol anyway. A rule kept in one component beats a rule every
 * call site has to remember.
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
  /* Keeps a glyph on the number's baseline rather than on the line box's. */
  ${({ $icon }) => ($icon ? "display: inline-flex; align-items: center;" : "")}
`;

/* Wraps a number and its unit so neither the thin space between them nor a
   compound symbol can be split across a line. */
const Unit__Quantity = styled.span`
  white-space: nowrap;
`;

/* The spoken word, for the accessibility tree only. Excluded from selection so
   copying "12.4 km" does not also yield "kilometres": the word is a reading of
   the symbol beside it, not extra content. */
const Unit__Word = styled(VisuallyHidden)`
  user-select: none;
`;

/** U+2009 THIN SPACE. SI puts a space between a number and its unit. */
const THIN_SPACE = "\u2009";

export interface UnitProps<U extends string = string>
  extends Omit<FormatQuantityOptions, "format"> {
  /**
   * The quantity to show. It carries its own unit, so nothing else needs to be
   * passed and nothing else can disagree with it.
   */
  value?: Value<U> | null;
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
  if (value !== undefined) {
    // formatted.symbol, NOT formatted.rung. They agree on a laddered value and
    // differ exactly where it matters: a duration comes back with its parts
    // interleaved into the value ("2h 14m") and an EMPTY symbol, while its
    // rung is still "s", so rendering the rung would print a stray "s" beside
    // a formatted duration. An absent value is the same shape, and renders no
    // unit rather than a unit beside the null token.
    const formatted = formatQuantity(value?.magnitude, value?.unit, opts);
    return (
      <Unit__Quantity className={className}>
        {formatted.value}
        <UnitSymbol token={formatted.symbol} spaced />
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
