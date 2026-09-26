import { css } from "styled-components";

/**
 * The one treatment for a container's own name: a panel's header and a modal's
 * title. It takes the value size, since a title names its container rather than
 * annotating something beside it, and keeps the uppercase, tracked, dim family
 * that gives the chrome its character.
 */
export const titleText = css`
  font-size: var(--font-size-value);
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;
