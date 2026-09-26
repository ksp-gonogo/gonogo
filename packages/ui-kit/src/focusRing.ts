import { css } from "styled-components";

/**
 * The keyboard focus ring, defined once for the kit.
 *
 * The colour is `--color-focus`, not the same-valued `--color-accent-fg`, so
 * focus stays retunable on its own. Kit-internal, not on the barrel.
 */
export const focusRing = css`
  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

/**
 * The same ring drawn inside the element's own edge, for a full-bleed control
 * whose parent clips it: a row, a tab, a rail segment, where a ring outside the
 * box would be clipped away.
 */
export const focusRingInset = css`
  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: -2px;
  }
`;
