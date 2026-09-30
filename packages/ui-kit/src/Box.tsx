import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { INSET_NAME, type InsetToken, RADIUS_VAR } from "./scales";

/**
 * The background tiers {@link Box} can paint: `app` is the page behind every
 * widget, `panel` a widget's own body, `raised` something lifted off a panel
 * (a card, a popover) and `sunken` a well set into one.
 *
 * @category Layout
 */
export type BoxSurface = "app" | "panel" | "raised" | "sunken";

/**
 * The corner radii {@link Box} accepts: `regular` for ordinary controls, rows
 * and cards, `floating` for something that sits above the app (a dialog, a
 * menu), and `pill` for a fully rounded stadium. The display-frame corner is
 * reserved for {@link FramedDisplay}.
 *
 * @category Layout
 */
export type BoxRadius = "regular" | "floating" | "pill";

/**
 * The padding names {@link Box}'s `pad` prop accepts, the same set as
 * {@link InsetToken}.
 *
 * @category Layout
 */
export type BoxPad = InsetToken;

/**
 * Props for {@link Box}. Any other `div` attribute passes through.
 *
 * @category Layout
 */
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

/**
 * A `div` that paints a surface: background tier, padding, a subtle border and
 * a corner radius, each optional. With no props it is a plain `div`. Use it for
 * a well or an inset block; use {@link Card} for a titled item in a list.
 *
 * @category Layout
 */
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
