/**
 * The mark a figure carries when it is no longer a reading of now.
 *
 * One implementation, shared, because it is one ruled fact: a dot at
 * superscript height in the warning hue the panel badge is painted from. A
 * second copy is how two readouts on one screen come to say the same thing
 * two ways.
 */
import styled from "styled-components";
import { severityDotColor } from "./status/severityDotColor";

/**
 * The dot itself.
 *
 * Absolutely positioned, so it occupies no line box and the column measures
 * the same to the pixel whether or not it is there. A prefix or suffix glyph
 * IN THE FLOW reflows a table column every time a channel goes quiet, which is
 * the loudest possible way to say something quiet.
 *
 * `left: 100%` reads off the containing block, so the dot follows its value's
 * own right edge however wide the number is, and `top: 0` is the top of that
 * inline box: superscript height without a `<sup>`, whose font-size change
 * would have to be undone for a box with no text in it.
 *
 * Sized in `em` with a pixel floor, because an uncapped 0.3em in an 11px
 * caption lands under 4px, which is a smudge rather than a dot. The hue comes
 * from `severityDotColor` rather than a literal, so a marked cell and the
 * badge above it paint one fact in one colour.
 *
 * It needs a positioned container to hang off: use {@link NotCurrentHost}, or
 * a container of your own that is `position: relative` and does not wrap.
 */
export const NotCurrentMark = styled.span`
  position: absolute;
  left: 100%;
  top: 0;
  width: max(0.3em, 4px);
  height: max(0.3em, 4px);
  margin-left: 0.14em;
  border-radius: var(--radius-circle);
  background: ${severityDotColor("warning")};
`;

/**
 * Something for the mark to hang off, for a component that renders bare text
 * and so has no box of its own.
 *
 * `nowrap` is what makes it a single rectangle: a phrase broken across two
 * lines has two right edges, and the dot would follow the wrong one.
 */
export const NotCurrentHost = styled.span`
  position: relative;
  white-space: nowrap;
`;
