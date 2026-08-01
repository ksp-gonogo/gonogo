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
 */
export const SectionTitle = styled.div`
  margin: 0;
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;
