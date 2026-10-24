import { css } from "styled-components";

/** A glyph button in a tile's header grows to a 44px touch target under a coarse pointer, whatever its drawn box is. */
export const touchTarget = css`
  @media (pointer: coarse) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
  }
`;
