import type { HTMLAttributes } from "react";
import styled from "styled-components";
import { GAP_VAR, type GapToken } from "./scales";

export interface DividerProps extends HTMLAttributes<HTMLHRElement> {
  /**
   * Vertical space above and below the rule, as a gap job.
   * Omit for a flush rule (the caller owns the spacing).
   */
  space?: GapToken;
}

/**
 * A full-width 1px horizontal rule on the subtle border colour: the one way to
 * separate stacked sections. A real `<hr>`, so it carries separator semantics.
 */
export function Divider({ space, ...rest }: DividerProps) {
  return <Divider__Root $space={space} {...rest} />;
}

const Divider__Root = styled.hr<{ $space?: GapToken }>`
  border: 0;
  border-top: 1px solid var(--color-border-subtle);
  width: 100%;
  margin: ${({ $space }) => ($space ? `${GAP_VAR[$space]} 0` : "0")};
`;
