import styled from "styled-components";
import { MicroscopeIcon, StarIcon } from "./Icons";
import { VisuallyHidden } from "./VisuallyHidden";

/** The three career currencies, keyed by their `Sitrep.Contract.Units` token. */
export type CurrencyKind = "funds" | "science" | "rep";

/**
 * The unit marker beside a career-currency value.
 *
 * Funds keeps its `f` suffix, which is the in-game convention and already what
 * every funds readout shows. Science and reputation take an icon, chosen from a
 * rendered trial: a microscope and a star, both close to their in-game glyphs.
 *
 * **The word survives the icon.** An icon is `aria-hidden` (lucide sets it, and
 * so does this package's icon wrapper), so an icon-only unit would read to a
 * screen reader as a bare number: "142" with no clue it is science. The word
 * therefore stays in the accessibility tree via `VisuallyHidden`, which is the
 * whole reason this is a component rather than a bare icon at the call site.
 *
 * Icons are sized in `em` so they track whatever font size the readout is set
 * at, which runs 10px to 12px across the currency call sites. lucide passes
 * `size` straight through to the SVG's width and height with no numeric
 * coercion, so an `em` value is valid there.
 */
export interface CurrencyUnitProps {
  kind: CurrencyKind;
  className?: string;
}

const WORD: Record<CurrencyKind, string> = {
  funds: "funds",
  science: "science",
  rep: "reputation",
};

export function CurrencyUnit({ kind, className }: CurrencyUnitProps) {
  if (kind === "funds") {
    return (
      <CurrencyUnit__Root className={className}>
        <span aria-hidden="true">f</span>
        <VisuallyHidden> {WORD.funds}</VisuallyHidden>
      </CurrencyUnit__Root>
    );
  }

  const Glyph = kind === "science" ? MicroscopeIcon : StarIcon;
  return (
    <CurrencyUnit__Root className={className}>
      <Glyph size="1em" />
      <VisuallyHidden> {WORD[kind]}</VisuallyHidden>
    </CurrencyUnit__Root>
  );
}

/**
 * `0.9em` rather than the 0.72em `Unit` uses: these glyphs are read as shapes
 * rather than letterforms, and lucide draws on a 24-unit grid at stroke 1.8, so
 * at 0.72 of a 10px readout the effective stroke falls under one device pixel
 * and the microscope in particular stops being legible.
 */
const CurrencyUnit__Root = styled.span`
  display: inline-flex;
  align-items: center;
  margin-left: var(--space-2, 2px);
  font-size: 0.9em;
  /* Inherit rather than pin to faint: several call sites colour the whole
     readout (a tech cost turns red when unaffordable, a strategy tally takes
     its category colour), and a unit that ignored that would read as a
     different value's unit. */
  color: inherit;
  vertical-align: baseline;
`;
