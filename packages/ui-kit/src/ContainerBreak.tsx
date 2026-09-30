import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import styled, { type CSSObject } from "styled-components";

/**
 * Props for {@link ContainerBreak}.
 *
 * @category Layout
 */
export interface ContainerBreakProps extends HTMLAttributes<HTMLDivElement> {
  /** Container width in px past which `wide` applies instead of `narrow`. */
  at: number;
  /** Styles applied while the container is narrower than `at`. */
  narrow?: CSSProperties;
  /** Styles applied once the container is at least `at` px wide, layered over `narrow`. */
  wide?: CSSProperties;
  children?: ReactNode;
}

/**
 * A `div` that switches between two sets of inline styles at a container-query
 * breakpoint, which a React `style` prop cannot express on its own. The
 * nearest ancestor with `container-type: inline-size` (a plain
 * `<div style={{ containerType: "inline-size" }}>` is enough) decides which
 * side of `at` this element is on. Both style sets are ordinary React
 * `CSSProperties`.
 *
 * @example
 * ```tsx
 * <div style={{ containerType: "inline-size" }}>
 *   <ContainerBreak
 *     at={360}
 *     narrow={{ display: "flex", flexDirection: "column" }}
 *     wide={{ flexDirection: "row" }}
 *   >
 *     {chart}
 *     {legend}
 *   </ContainerBreak>
 * </div>
 * ```
 *
 * @category Layout
 */
export function ContainerBreak({
  at,
  narrow,
  wide,
  children,
  ...rest
}: ContainerBreakProps) {
  return (
    <ContainerBreak__Root $at={at} $narrow={narrow} $wide={wide} {...rest}>
      {children}
    </ContainerBreak__Root>
  );
}

const ContainerBreak__Root = styled.div<{
  $at: number;
  $narrow?: CSSProperties;
  $wide?: CSSProperties;
}>`
  ${({ $narrow }) => $narrow as CSSObject}
  @container (min-width: ${({ $at }) => $at}px) {
    ${({ $wide }) => $wide as CSSObject}
  }
`;
