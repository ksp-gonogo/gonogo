import { css } from "styled-components";

/**
 * Declare that this box's own EDGES are content, not decoration.
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
 * Declare that this box PAINTS OVER the scrolling content behind it.
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
