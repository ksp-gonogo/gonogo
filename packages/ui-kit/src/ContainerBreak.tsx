import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import styled, { type CSSObject, css } from "styled-components";

/**
 * Props for {@link ContainerBreak}.
 * Useful for giving a region the two sets of styles it switches between as its
 * panel narrows or widens. Used by {@link ContainerBreak}.
 *
 * @category Layout
 */
export interface ContainerBreakProps extends HTMLAttributes<HTMLDivElement> {
  /** Container width in px past which `wide` applies instead of `narrow`. */
  at?: number;
  /**
   * Container aspect ratio (width over height) past which `wide` applies,
   * for a container sized in both axes (`container-type: size`). With `at`
   * as well, `wide` applies once both are met.
   */
  atAspect?: number;
  /** Styles applied while the container is narrower than `at`. */
  narrow?: CSSProperties;
  /** Styles applied once the container is at least `at` px wide, layered over `narrow`. */
  wide?: CSSProperties;
  /** The content the styles lay out. */
  children?: ReactNode;
}

/**
 * A `div` that switches between two sets of inline styles at a container-query
 * breakpoint, which a React `style` prop cannot express on its own. Useful for
 * a widget whose layout changes with the width of its panel. Used by the
 * maneuver planner's preview. The nearest ancestor with `container-type:
 * inline-size` (a plain `<div style={{ containerType: "inline-size" }}>` is
 * enough) decides which side of `at` this element is on. Both style sets are
 * ordinary React `CSSProperties`.
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
  atAspect,
  narrow,
  wide,
  children,
  ...rest
}: ContainerBreakProps) {
  return (
    <ContainerBreak__Root
      $query={breakQuery(at, atAspect)}
      $narrow={narrow}
      $wide={wide}
      {...rest}
    >
      {children}
    </ContainerBreak__Root>
  );
}

/** The container query under which `wide` applies, or none when neither breakpoint is set. */
function breakQuery(at?: number, atAspect?: number): string | undefined {
  const conditions = [
    at === undefined ? undefined : `(min-width: ${at}px)`,
    atAspect === undefined ? undefined : `(aspect-ratio >= ${atAspect})`,
  ].filter((c) => c !== undefined);
  return conditions.length === 0 ? undefined : conditions.join(" and ");
}

const ContainerBreak__Root = styled.div<{
  $query?: string;
  $narrow?: CSSProperties;
  $wide?: CSSProperties;
}>`
  ${({ $narrow }) => $narrow as CSSObject}
  ${({ $query, $wide }) =>
    $query === undefined
      ? ""
      : css`
          @container ${$query} {
            ${$wide as CSSObject}
          }
        `}
`;
