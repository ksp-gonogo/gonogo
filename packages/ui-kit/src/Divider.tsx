import type { HTMLAttributes } from "react";
import styled from "styled-components";
import type { SpaceToken } from "./Stack";

export interface DividerProps extends HTMLAttributes<HTMLHRElement> {
  /**
   * Vertical space above and below the rule, snapped to the space scale.
   * Omit for a flush rule (the caller owns the spacing).
   */
  space?: SpaceToken;
}

/**
 * A full-width 1px horizontal rule on the subtle border colour: the one way to
 * separate stacked sections. Replaces the hand-rolled `border-bottom`/
 * `border-top` dividers widgets grew (ScienceOfficer's `LabList` rule,
 * ScienceBench's `CareerStrip` top border). A real `<hr>`, so it carries the
 * separator semantics for free.
 */
export function Divider({ space, ...rest }: DividerProps) {
  return <Divider__Root $space={space} {...rest} />;
}

const Divider__Root = styled.hr<{ $space?: SpaceToken }>`
  border: 0;
  border-top: 1px solid var(--color-border-subtle);
  width: 100%;
  margin: ${({ theme, $space }) => ($space ? `${theme.space[$space]} 0` : "0")};
`;
