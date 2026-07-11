import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/**
 * Sunken inset card — a nested surface for a single record inside a list
 * (a tracked vessel, a fleet entry). Extracted from the Scanning widget's
 * `VesselCard`.
 */
export const Card = styled.div<CardProps>`
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  padding: 6px 8px;
`;
