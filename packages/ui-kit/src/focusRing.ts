import { css } from "styled-components";

/**
 * The keyboard focus ring, defined once for the kit.
 *
 * <para>The colour is `--color-focus` rather than `--color-accent-fg`. The two
 * resolve to the same value, so a ring spelled as the accent looks correct and
 * stops being retunable: changing focus would mean moving every accent in the
 * kit. Naming the job keeps the token load-bearing.</para>
 *
 * <para>Kit-internal on purpose, and not on the barrel. A consumer that could
 * interpolate this already imports styled-components, which is what widgets are
 * being moved off.</para>
 */
export const focusRing = css`
  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

/**
 * The same ring drawn inside the element's own edge, for a full-bleed control
 * whose parent clips it: a row, a tab, a rail segment. At a positive offset the
 * ring is painted outside the box and the parent's `overflow` removes it, so
 * the control appears to have no focus indicator at all.
 */
export const focusRingInset = css`
  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: -2px;
  }
`;
