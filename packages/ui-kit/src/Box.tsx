import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { INSET_NAME, type InsetToken, RADIUS_VAR } from "./scales";

export type BoxSurface = "app" | "panel" | "raised" | "sunken";
/** `displayFrame` is deliberately absent: that corner belongs to `FramedDisplay`. */
export type BoxRadius = "regular" | "floating" | "pill";
export type BoxPad = InsetToken;

export interface BoxProps extends HTMLAttributes<HTMLDivElement> {
  /** Background surface tier. Omit for a transparent box. */
  surface?: BoxSurface;
  /** Padding, as the name of a surface inset. */
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

/** Background/border/padding/radius wrapper: the generic surface primitive. */
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
  ${({ $radius }) => $radius && `border-radius: ${RADIUS_VAR[$radius]};`}
  ${({ $pad }) => $pad && `padding: var(${INSET_NAME[$pad]});`}
`;
