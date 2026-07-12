import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";

export type SpaceToken = "xs" | "sm" | "md" | "lg" | "xl";

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /** Gap between children, snapped to the space scale. Defaults to `sm`. */
  gap?: SpaceToken;
  children?: ReactNode;
}

/**
 * Vertical flex list — the most common container shape in the dashboard.
 * Replaces the many ad-hoc `styled.div\`flex-direction:column;gap:…\`` blocks
 * scattered across widgets (e.g. ScienceOfficer's `Group`/`InstrumentList`/
 * `LabList`).
 */
export function Stack({ gap = "sm", children, ...rest }: StackProps) {
  return (
    <Stack__Root $gap={gap} {...rest}>
      {children}
    </Stack__Root>
  );
}

const Stack__Root = styled.div<{ $gap: SpaceToken }>`
  display: flex;
  flex-direction: column;
  gap: ${({ theme, $gap }) => theme.space[$gap]};
`;
