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
  narrow?: CSSProperties;
  wide?: CSSProperties;
  children?: ReactNode;
}

/**
 * A container-query breakpoint with no stylesheet of its own to open at the
 * call site. React inline styles cannot express `@container`, so this is
 * where that gap closes; a nearest ancestor with `container-type:
 * inline-size` (a plain `<div style={{ containerType: "inline-size" }}>` is
 * enough) decides which side of `at` this element is on.
 *
 * Props stay typed as React's own `CSSProperties`, not styled-components'
 * `CSSObject`, so a caller composing this never has a reason to import
 * `styled-components` itself.
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
