import { css } from "styled-components";

/**
 * Marks a box whose own edges are content, not decoration. Useful for having the
 * minimum-size audit report when a tile clips or pushes out a box the operator
 * needs to see whole. Used by {@link Badge}.
 *
 * The min-fit audit (`auditMinFit` in `@ksp-gonogo/uplink-tools`) reports text a
 * tile cuts off but not boxes, since many are drawn oversized on purpose. A box
 * carrying this is one whose shape is the affordance, so a clipped edge is
 * reported under `box-clipped` / `box-escapes-tile`.
 *
 * `name` is what a finding calls the box, so pick the primitive's own name. A
 * custom property rather than an attribute, so DOM snapshots are unaffected.
 */
export const fitBox = (name: string) => css`
  --fit-box: ${name};
`;

/**
 * Marks a box that paints over the scrolling content behind it. Useful for having
 * the minimum-size audit report a mask that hides more of a short body than the
 * operator can afford to lose. Used by the panel's scroll glow.
 *
 * A scroll glow is drawn at a fixed height, so on a short body it can mask more
 * than the overflow it advertises. `auditMinFit` reports that under
 * `masked-by-glow`, reading the depth from the element's computed gradient.
 *
 * `name` is what a finding calls the mask.
 */
export const fitMask = (name: string) => css`
  --fit-mask: ${name};
`;
