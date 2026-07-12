import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { Stack } from "./Stack";

export interface SectionProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/**
 * A named group of rows within a panel — `Stack` pinned to the tightest gap.
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
 */
export const SectionTitle = styled.div`
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;
