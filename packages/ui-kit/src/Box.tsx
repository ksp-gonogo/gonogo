import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import type { SpaceToken } from "./Stack";

export type BoxSurface = "app" | "panel" | "raised" | "sunken";
export type BoxRadius = "xs" | "sm" | "md" | "pill";
export type BoxPad = SpaceToken | [SpaceToken, SpaceToken];

export interface BoxProps extends HTMLAttributes<HTMLDivElement> {
  /** Background surface tier. Omit for a transparent box. */
  surface?: BoxSurface;
  /** Padding on all sides, or a `[vertical, horizontal]` pair. */
  pad?: BoxPad;
  /** Adds a `1px solid` subtle border. Defaults to `false`. */
  bordered?: boolean;
  /** Corner radius. Omit for square corners. */
  radius?: BoxRadius;
  children?: ReactNode;
}

const SURFACE_VAR: Record<BoxSurface, string> = {
  app: "var(--color-surface-app)",
  panel: "var(--color-surface-panel)",
  raised: "var(--color-surface-raised)",
  sunken: "var(--color-surface-sunken)",
};

/** Background/border/padding/radius wrapper — the generic surface primitive. */
export function Box({
  surface,
  pad,
  bordered = false,
  radius,
  children,
  ...rest
}: BoxProps) {
  return (
    <Box__Root
      $surface={surface}
      $pad={pad}
      $bordered={bordered}
      $radius={radius}
      {...rest}
    >
      {children}
    </Box__Root>
  );
}

const Box__Root = styled.div<{
  $surface?: BoxSurface;
  $pad?: BoxPad;
  $bordered: boolean;
  $radius?: BoxRadius;
}>`
  ${({ $surface }) => $surface && `background: ${SURFACE_VAR[$surface]};`}
  ${({ $bordered }) => $bordered && `border: 1px solid var(--color-border-subtle);`}
  ${({ theme, $radius }) => $radius && `border-radius: ${theme.radii[$radius]};`}
  ${({ theme, $pad }) => {
    if (!$pad) return "";
    if (Array.isArray($pad)) {
      const [y, x] = $pad;
      return `padding: ${theme.space[y]} ${theme.space[x]};`;
    }
    return `padding: ${theme.space[$pad]};`;
  }}
`;
