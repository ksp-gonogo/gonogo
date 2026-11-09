import type { CSSProperties, ReactNode } from "react";
import styled, { keyframes } from "styled-components";

/**
 * Props for {@link FlowChevrons}.
 *
 * @category Telemetry
 */
export interface FlowChevronsProps {
  /** The distance in SVG units between one chevron and the next, which is how far the group moves each cycle. */
  stride: number;
  /** The chevrons, laid out along the local x axis at this spacing. */
  children: ReactNode;
}

const travel = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(var(--flow-stride)); }
`;

const Group = styled.g`
  @media (prefers-reduced-motion: no-preference) {
    animation: ${travel} 0.6s linear infinite;
  }
`;

/**
 * An SVG group that moves evenly spaced chevrons along its x axis in a seamless
 * loop, standing still when the operator prefers reduced motion. Useful for
 * showing that something is flowing and which way. Used by the vessel
 * schematic's resource transfer pipes.
 *
 * @category Telemetry
 */
export function FlowChevrons({
  stride,
  children,
}: Readonly<FlowChevronsProps>) {
  return (
    <Group style={{ "--flow-stride": `${stride}px` } as CSSProperties}>
      {children}
    </Group>
  );
}
