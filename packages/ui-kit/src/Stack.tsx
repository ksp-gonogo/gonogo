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
   * Gap between children, as a gap job. Omit it and the gap is
   * `--gap-related`, inherited from whichever container the stack lands in, so
   * the same stack is 8px on a panel and 6px inside a card. Pass a job only
   * from a container deciding the spacing for what it holds.
   */
  gap?: GapToken;
  /** Rendered tag. Defaults to `div`. */
  as?: StaticElement;
  /**
   * Take the remaining space in a flex parent, and allow shrinking below the
   * content's natural height. That pair is what lets a scroller nested inside
   * actually scroll instead of growing the whole column.
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
 * ```tsx
 * <Stack gap="section">
 *   <Cluster>
 *     <Text>Target</Text>
 *     <Inline>
 *       <Button onClick={onSet}>Set</Button>
 *       <Button onClick={onClear}>Clear</Button>
 *     </Inline>
 *   </Cluster>
 *   <Grid cols="auto 1fr" gap="label-value" rowGap="readout-row" align="baseline">
 *     <Text level="muted">Apoapsis</Text>
 *     <Text>{apoapsis}</Text>
 *     <Text level="muted">Periapsis</Text>
 *     <Text>{periapsis}</Text>
 *   </Grid>
 *   <Box surface="sunken" pad="surface" radius="regular">
 *     {notes}
 *   </Box>
 * </Stack>
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
`;
