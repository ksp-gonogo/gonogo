import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { GAP_VAR, type GapToken } from "./scales";
import type { StaticElement } from "./staticElement";

/**
 * Props for {@link Stack}. Any other `div` attribute passes through.
 *
 * @category Layout
 */
export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Gap between children, one of the {@link GapToken} names. Omitted, the
   * stack takes the `related` gap of whatever container it sits in, so the
   * same stack is 8px on a panel and 6px inside a card. Set it only where this
   * stack decides the spacing of what it holds.
   */
  gap?: GapToken;
  /** Rendered tag. Defaults to `div`. */
  as?: StaticElement;
  /**
   * Take the remaining space in a flex parent and allow shrinking below the
   * content's natural height, so a scrolling region inside the stack scrolls
   * rather than growing the whole column.
   */
  fill?: boolean;
  children?: ReactNode;
}

/**
 * A vertical flex column, the most common container shape in a widget body.
 * Children sit one above the other with the container's related gap between
 * them unless `gap` names another.
 *
 * The layout primitives compose: a {@link Stack} of sections, a
 * {@link Cluster} for a label beside its controls, a {@link Grid} for a
 * label/value table, and a {@link Box} for an inset well.
 *
 * @example
 * `gap="section"` sets the three blocks further apart than the default
 * `related` gap would.
 * ```tsx
 * import { Box, Button, Cluster, Grid, Inline, Stack, Text } from "@ksp-gonogo/ui-kit";
 *
 * function TargetBody(props: {
 *   apoapsis: string;
 *   periapsis: string;
 *   notes: string;
 *   onSet: () => void;
 *   onClear: () => void;
 * }) {
 *   return (
 *     <Stack gap="section">
 *       <Cluster>
 *         <Text>Target</Text>
 *         <Inline>
 *           <Button onClick={props.onSet}>Set</Button>
 *           <Button onClick={props.onClear}>Clear</Button>
 *         </Inline>
 *       </Cluster>
 *       <Grid cols="auto 1fr" gap="label-value" rowGap="readout-row" align="baseline">
 *         <Text level="muted">Apoapsis</Text>
 *         <Text>{props.apoapsis}</Text>
 *         <Text level="muted">Periapsis</Text>
 *         <Text>{props.periapsis}</Text>
 *       </Grid>
 *       <Box surface="sunken" pad="surface" radius="regular">
 *         {props.notes}
 *       </Box>
 *     </Stack>
 *   );
 * }
 * ```
 *
 * @category Layout
 */
export function Stack({ gap, fill = false, children, ...rest }: StackProps) {
  return (
    <Stack__Root $gap={gap} $fill={fill} {...rest}>
      {children}
    </Stack__Root>
  );
}

const Stack__Root = styled.div<{ $gap?: GapToken; $fill: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${({ $gap }) => ($gap ? GAP_VAR[$gap] : "var(--gap-related)")};
  ${({ $fill }) => ($fill ? "flex: 1; min-height: 0;" : "")}

  /* Rendered as a list it is still a layout box: the browser's own list indent, margin and bullets would shift and squeeze its rows. Zero specificity, so a caller's own rule still wins. */
  &:where(ul, ol) {
    margin: 0;
    padding: 0;
    list-style: none;
  }
`;
