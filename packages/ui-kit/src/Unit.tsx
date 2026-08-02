import type { ReactNode } from "react";
import styled from "styled-components";
import { MicroscopeIcon, StarIcon } from "./Icons";
import { displaySymbol, kindOfUnit, wordForSymbol } from "./units";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * A unit, rendered from the unit MODEL rather than from a literal at the call
 * site.
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

/**
 * The symbols SI writes hard against the number. Plane angle only: degree,
 * arcminute, arcsecond. Deliberately NOT the degree-Celsius pair, which takes
 * the normal space.
 */
const ATTACHED = new Set(["°", "′", "″"]);

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
  /* Scales with the text, so the gap does not look tight in a big readout and
     loose in a small one. Margin rather than a space character so the symbol
     cannot be split from its number by a line break. */
  margin-inline-start: ${({ $attached }) => ($attached ? "0" : "0.25em")};
  /* "m/s" and "kg/m³" must never wrap mid-symbol. */
  white-space: nowrap;
  /* A unit is not a word: it must survive a parent that uppercases its text,
     because m and M are metre and mega. This already bit the Graph header. */
  text-transform: none;
  /* Keeps a glyph on the number's baseline rather than on the line box's. */
  ${({ $icon }) => ($icon ? "display: inline-flex; align-items: center;" : "")}
`;

export interface UnitProps {
  /**
   * The unit token the contract declares, or a rung symbol. Resolved through
   * the unit model for its display form, its icon and its spoken word.
   */
  children?: ReactNode;
  className?: string;
}

export function Unit({ children, className }: UnitProps) {
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

  const symbol = displaySymbol(children, kindOfUnit(children));

  // The category kinds (count, id, text, flag, enum, n/a) display as an empty
  // string on purpose: they name what a field IS rather than what it is
  // measured in, and "3 count" is not a readout. Nothing to render, and
  // nothing to announce either.
  if (symbol === "") return null;

  const word = wordForSymbol(symbol);
  const Glyph = ICON_BY_SYMBOL[symbol as keyof typeof ICON_BY_SYMBOL];

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
    <Unit__Span
      $attached={ATTACHED.has(symbol)}
      $icon={Glyph !== undefined}
      className={className}
      data-unit={children}
    >
      {Glyph ? (
        <Glyph size="1em" />
      ) : spoken ? (
        <span aria-hidden="true">{symbol}</span>
      ) : (
        symbol
      )}
      {spoken && <VisuallyHidden> {word}</VisuallyHidden>}
    </Unit__Span>
  );
}
