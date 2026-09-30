import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { Stack } from "./Stack";
import type { GapToken } from "./scales";
import type { StaticElement } from "./staticElement";

/** Marks a section that spans every column of a panel's section grid; the rule acting on it lives on the grid (see `Panel`). */
export const SECTION_FULL_ATTR = "data-section-full";

/** Marks a section that takes the panel body's leftover height; the rule acting on it lives on the body (see `Panel`). */
export const SECTION_FILL_ATTR = "data-section-fill";

/**
 * Props for {@link Section}. Any other `div` attribute passes through, except
 * the HTML `title`, whose name is taken by the heading.
 *
 * @category Layout
 */
export interface SectionProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Rendered tag. Defaults to `div`. */
  as?: StaticElement;
  /** Gap between the section's children. Defaults to `rows`; a section of groups wants a wider one. */
  gap?: GapToken;
  /** The section's heading, rendered as a `SectionTitle` above its children. */
  title?: ReactNode;
  /** Tag for `title`. Defaults to `h4`, the level under a panel's own `h3`. */
  titleAs?: StaticElement;
  /**
   * Span every column of the panel's section grid rather than taking one, for a
   * summary strip or a table whose columns are already its own. Inert outside a
   * grid parent.
   */
  full?: boolean;
  /**
   * Take the panel body's leftover height rather than the section's natural
   * one, for a section that is a drawing (a map, a plot, a dial).
   *
   * A filling section is lifted out of the section grid, so it always spans the
   * panel's full width; ordinary sections around it still columnise. Two filling
   * sections each keep their content height and share the leftover equally.
   * Ignored under `fitToSize`, and inert outside a panel body.
   */
  fill?: boolean;
  children?: ReactNode;
}

/**
 * A named group of rows inside a panel: a {@link Stack} at the `rows` gap,
 * headed by a {@link SectionTitle} when `title` is set. Inside a panel body,
 * `full` spans every column of the section grid and `fill` takes the body's
 * leftover height.
 *
 * @category Layout
 */
export function Section({
  children,
  gap = "rows",
  title,
  titleAs = "h4",
  full = false,
  fill = false,
  ...rest
}: SectionProps) {
  return (
    /* Not `Stack`'s own `fill`: that is a zero basis, splitting the body evenly
       however little is in either section, where the body's rule divides only
       what is spare. */
    <Stack
      gap={gap}
      {...{
        [SECTION_FULL_ATTR]: full ? "" : undefined,
        [SECTION_FILL_ATTR]: fill ? "" : undefined,
      }}
      {...rest}
    >
      {title == null ? null : <SectionTitle as={titleAs}>{title}</SectionTitle>}
      {children}
    </Stack>
  );
}

/**
 * The uppercase, tracked-out heading {@link Section} draws for its `title`,
 * usable on its own. Use `as="h3"` (or another heading tag) for a real heading;
 * `$rule` draws a hairline under it.
 *
 * @category Layout
 */
export const SectionTitle = styled.div<{ $rule?: boolean }>`
  margin: 0;
  font-size: var(--font-size-value);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  ${({ $rule }) =>
    $rule
      ? `
  padding-bottom: var(--gap-title-rule);
  border-bottom: 1px solid var(--color-border-subtle);
`
      : ""}
`;
