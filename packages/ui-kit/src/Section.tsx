import type { ElementType, HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { type SpaceToken, Stack } from "./Stack";

/**
 * Marks a section that should span every column of a panel's section grid. The
 * rule that acts on it lives on the GRID (see `Panel`), not here: `grid-column`
 * is a property of the grid item, and a wrapper element around `Stack` to carry
 * it would have swallowed the `as` passthrough that `styled` treats as its own.
 */
export const SECTION_FULL_ATTR = "data-section-full";

/**
 * `title` is OMITTED from the div's own attributes so the section's heading can
 * take the name. HTML types that attribute as a tooltip string, so the two
 * cannot coexist; `PanelTitleProps` makes the same trade for the same reason.
 *
 * `Panel` went the other way and named its heading `panelTitle`, because a panel
 * is the outer box a widget hands arbitrary div props to and losing its tooltip
 * was a real cost. A section is a content group the kit composes, nothing in the
 * tree gives one a tooltip, and `sectionTitle` inside a component called
 * `Section` would be a name apologising for a collision that does not bite here.
 */
export interface SectionProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /**
   * Rendered tag. Defaults to `div`. Declared for the same reason `Stack` and
   * `Row` declare it, and added when PowerSystems adopted this in place of its
   * own `styled.section`: a widget should not have to give up the semantic
   * element to use the kit. It reached `Stack` through the rest spread before
   * this, which worked and was invisible to a caller reading the type.
   */
  as?: ElementType;
  /**
   * Gap between the section's children. Defaults to the tightest step, which is
   * right for a section whose children are rows.
   *
   * A section whose children are themselves GROUPS wants more than that: its
   * title, each group's own heading and each group's rows all sat one step
   * apart, so the title read as a third heading in the same run rather than as
   * the thing the groups belong to. Declared here rather than as a margin at
   * the call site, so the spacing stays on the kit's scale.
   */
  gap?: SpaceToken;
  /**
   * The section's heading, rendered as a `SectionTitle` above its children.
   *
   * A prop rather than a child the caller writes itself, because that is what
   * lets `Panel sections` hand a widget its titles for free. Every widget that
   * grouped its body wrote the same `<SectionTitle as="h4">` line above the
   * same `Stack`, which is a shape the kit should own.
   */
  title?: ReactNode;
  /**
   * Tag for `title`. Defaults to `h4`, which is the level under a panel's own
   * `h3`, so a section heading joins the document outline in the right place
   * instead of being a styled `div` a screen reader cannot navigate to.
   *
   * Overridable because this component is also used outside a panel: the
   * settings and alarms modals head their sections at `h3`.
   */
  titleAs?: ElementType;
  /**
   * Span every column of the panel's section grid rather than taking one of
   * them.
   *
   * For the section a wide layout should not put beside another: a summary
   * strip the columns below it belong to, or a table whose columns are already
   * its own. Inert outside a grid parent, so a section carrying it still reads
   * correctly in a modal or a hand-composed body.
   */
  full?: boolean;
  children?: ReactNode;
}

/**
 * A named group of rows within a panel, a `Stack` at the tightest gap.
 * Extracted from ScienceOfficer's `Group` (`flex-direction:column;gap:2px`).
 */
export function Section({
  children,
  gap = "xs",
  title,
  titleAs = "h4",
  full = false,
  ...rest
}: SectionProps) {
  return (
    <Stack
      gap={gap}
      {...{ [SECTION_FULL_ATTR]: full ? "" : undefined }}
      {...rest}
    >
      {title == null ? null : <SectionTitle as={titleAs}>{title}</SectionTitle>}
      {children}
    </Stack>
  );
}

/**
 * Uppercase, tracked-out label for a `Section`. Extracted from
 * ScienceOfficer's `GroupLabel`.
 *
 * `font-weight: 700` and `margin: 0` were added when nine hand-rolled copies of
 * this label were collected: seven of the nine set the bold weight, so the
 * original extraction had simply missed it, and every copy that rendered as a
 * heading had to zero the margin itself. Both belong here rather than at nine
 * call sites.
 *
 * A `styled.div`, so `as="h3"` gives a real heading where the document outline
 * wants one without forking the type treatment.
 *
 * `$rule` draws a hairline under the label. It exists because three modals
 * (settings, mission profiles, the flight-outcome banner) had each hand-rolled
 * the identical `padding-bottom` plus `border-bottom` pair underneath their own
 * copy of this label. Three sites writing the same two declarations is a
 * variant the kit should own, not a coincidence.
 */
export const SectionTitle = styled.div<{ $rule?: boolean }>`
  margin: 0;
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  ${({ $rule }) =>
    $rule
      ? `
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--color-border-subtle);
`
      : ""}
`;
