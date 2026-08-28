import type { ElementType, HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { type SpaceToken, Stack } from "./Stack";

export interface SectionProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Rendered tag. Defaults to `div`. Declared for the same reason `Stack` and
   * `Row` declare it, and added when PowerSystems adopted this in place of its
   * own `styled.section`: a widget should not have to give up the semantic
   * element to use the kit. It reached `Stack` through the rest spread before
   * this, which worked and was invisible to a caller reading the type.
   */
  as?: ElementType;
  /**
   * Gap between the section's children. Defaults to the tightest step, which is
   * right for a section whose children are rows.
   *
   * A section whose children are themselves GROUPS wants more than that: its
   * title, each group's own heading and each group's rows all sat one step
   * apart, so the title read as a third heading in the same run rather than as
   * the thing the groups belong to. Declared here rather than as a margin at
   * the call site, so the spacing stays on the kit's scale.
   */
  gap?: SpaceToken;
  children?: ReactNode;
}

/**
 * A named group of rows within a panel, a `Stack` at the tightest gap.
 * Extracted from ScienceOfficer's `Group` (`flex-direction:column;gap:2px`).
 */
export function Section({ children, gap = "xs", ...rest }: SectionProps) {
  return (
    <Stack gap={gap} {...rest}>
      {children}
    </Stack>
  );
}

/**
 * Uppercase, tracked-out label for a `Section`. Extracted from
 * ScienceOfficer's `GroupLabel`.
 *
 * `font-weight: 700` and `margin: 0` were added when nine hand-rolled copies of
 * this label were collected: seven of the nine set the bold weight, so the
 * original extraction had simply missed it, and every copy that rendered as a
 * heading had to zero the margin itself. Both belong here rather than at nine
 * call sites.
 *
 * A `styled.div`, so `as="h3"` gives a real heading where the document outline
 * wants one without forking the type treatment.
 *
 * `$rule` draws a hairline under the label. It exists because three modals
 * (settings, mission profiles, the flight-outcome banner) had each hand-rolled
 * the identical `padding-bottom` plus `border-bottom` pair underneath their own
 * copy of this label. Three sites writing the same two declarations is a
 * variant the kit should own, not a coincidence.
 */
export const SectionTitle = styled.div<{ $rule?: boolean }>`
  margin: 0;
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  ${({ $rule }) =>
    $rule
      ? `
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border-subtle);
`
      : ""}
`;
