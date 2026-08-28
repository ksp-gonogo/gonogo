import { css } from "styled-components";

/**
 * Declare that this box's own EDGES are content, not decoration.
 *
 * The min-fit audit (`@ksp-gonogo/ui-kit/render`, `auditMinFit`) reports text
 * that a tile cuts off, and by default says nothing about boxes: a gauge arc, a
 * gradient bleed and a graph's plot area are all drawn oversized inside a
 * clipping parent on purpose, and nothing about their geometry tells them apart
 * from a pill whose rounded end is being sliced by a panel border. A box that
 * carries this is one where the shape itself is the affordance, so a clipped
 * edge is a defect even when every word inside it fits, and the audit reports
 * it under `box-clipped` / `box-escapes-tile`.
 *
 * `name` is what a finding calls the box, so pick the primitive's own name.
 *
 * A custom property rather than an attribute: an attribute on a kit primitive
 * rewrites the committed DOM snapshots of every widget that draws one, and this
 * says nothing a snapshot should be asserting.
 */
export const fitBox = (name: string) => css`
  --fit-box: ${name};
`;
