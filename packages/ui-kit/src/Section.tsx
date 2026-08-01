import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { Stack } from "./Stack";

export interface SectionProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/**
 * A named group of rows within a panel, `Stack` pinned to the tightest gap.
 * Extracted from ScienceOfficer's `Group` (`flex-direction:column;gap:2px`).
 */
export function Section({ children, ...rest }: SectionProps) {
  return (
    <Stack gap="xs" {...rest}>
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
