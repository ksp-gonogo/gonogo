import styled from "styled-components";

/**
 * A unit symbol, sized and dimmed RELATIVE to the text it sits in.
 *
 * Both, deliberately: the component exists so the concept has one name and one
 * place to change, and it is implemented relatively so it needs no size or tone
 * prop and composes into anything. Dropped into a 32px `BigReadout` it renders
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
 *   passed. 0.72 is the most that holds up against the panel surface for text
 *   that starts at token contrast. Anything quieter is not a unit any more, it
 *   is decoration.
 *
 * ## Accessibility
 *
 * This renders the SYMBOL, which a screen reader will read literally: "km" as
 * "kay em", "°" as nothing at all. Where that matters, the enclosing readout
 * should carry an `aria-label` with the unit spelled out ("twelve point four
 * kilometres"), which is why `formatQuantity` returns the parts separately
 * rather than a joined string. This component does not set `aria-hidden`: a
 * symbol nobody announces is worse than one announced awkwardly, and hiding it
 * unconditionally would strip the unit from readouts that never add a label.
 */
export const Unit = styled.span`
  /* Relative to the parent's font size, with a floor. */
  font-size: max(0.72em, 10px);
  /* Dims whatever colour it inherits, so the symbol keeps the value's tone. */
  opacity: 0.72;
  /* Scales with the text, so the gap does not look tight in a big readout and
     loose in a small one. Margin rather than a space character so the symbol
     cannot be split from its number by a line break. */
  margin-inline-start: 0.25em;
  /* "m/s" and "kg/m³" must never wrap mid-symbol. */
  white-space: nowrap;
  /* A unit is not a word: it must survive a parent that uppercases its text,
     because m and M are metre and mega. This already bit the Graph header. */
  text-transform: none;
`;
