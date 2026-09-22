import type { ElementType, HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { SubjectHeading } from "./SubjectHeading";

/**
 * The anatomy every record in the app hand-builds, as props.
 *
 * Measured over the 22 card sites: eleven of them are the same shape, a name,
 * zero to three badges on the name's line, a body of figures, zero to five
 * actions. Every one built that header out of a `Cluster` plus one of five
 * spellings of "this is the name" (`Text weight="semibold"`, a bare `<span>`,
 * a `Truncate`, a local `DeviceName`, nothing at all). Nothing made the first
 * row a heading, nothing sized it as one, and nothing stopped the second row
 * matching it.
 *
 * Props are the primary form, the same way `Panel` takes `panelTitle` and
 * `sections`. The compound parts below are the escape hatch for a widget that
 * needs a unique expression and still wants the type and spacing of the
 * family.
 */
export interface BlockAnatomyProps {
  /**
   * The name this record is about, drawn as a heading: larger and heavier than
   * the body under it.
   *
   * Omitted from the element's own attributes, so the heading can take the
   * name. HTML types `title` as a tooltip string and the two cannot coexist;
   * `Section` makes the same trade for the same reason. `Panel` went the other
   * way (`panelTitle`) because a panel is an outer box widgets hand arbitrary
   * div props to and losing its tooltip cost something real. A record is the
   * innermost box and nothing in the tree gives one a tooltip.
   */
  title?: ReactNode;
  /** Tag for `title`. Defaults to `div`; pass a heading where the outline wants one. */
  titleAs?: ElementType;
  /**
   * Drawn BEFORE the title, on the title's own line: a marker, a rank pip, an
   * index. Not a status, which reads after the thing it is a status of.
   */
  titleLeft?: ReactNode;
  /**
   * Drawn AFTER the title and pushed to the end of its line: the badges that
   * say how this record is doing. Wraps under the title rather than squeezing
   * it, because the name is the only part that says which record this is.
   *
   * Deliberately distinct from `right`. A badge belongs level with the name;
   * put it in the block-level aside and it lands beside (or, at narrow widths,
   * below) the whole body instead.
   */
  titleRight?: ReactNode;
  /**
   * Content beside the body, on the left. Reflows to a full-width row ABOVE the
   * body when there is no room for both.
   */
  left?: ReactNode;
  /** Content beside the body, on the right. Reflows BELOW the body when narrow. */
  right?: ReactNode;
  /** Content across the top, above the title. Already stacked, so it never moves. */
  top?: ReactNode;
  /** Content across the bottom, below the footer. Already stacked, so it never moves. */
  bottom?: ReactNode;
  /** The actions and tags that close the record, spread across one wrapping row. */
  footer?: ReactNode;
  children?: ReactNode;
}

export interface BlockProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "title">,
    BlockAnatomyProps {
  /**
   * Rendered tag. Defaults to `div`. A record in a list wants `li`; `Strategies`
   * wants `article`; a banner wants `section`.
   */
  as?: ElementType;
}

/**
 * The name, sized as one. The whole of the asymmetry this component exists to
 * fix: `Panel` has `panelTitle`, `Section` has `title`, and a card had nothing,
 * so its first and second rows came out identically sized.
 *
 * Type belongs to the ARRANGEMENT, not to the surface, which is why it is
 * declared here and `Card` inherits it rather than restating it. A widget
 * hand-composing from `Card.Title` gets the same glyphs as one passing
 * `title=`, because it is the same object.
 */
const Block__Title = styled.div`
  color: var(--color-text-primary);
  font-weight: 600;
  font-size: var(--font-size-sm);
  line-height: var(--line-height-tight);
  /* A content-sized basis, not a zero one. With a zero basis the title always
     "fits" its flex line at its pre-grow hypothetical size, so the row never
     wraps even when there is no room and a long name runs straight into the
     badge beside it. */
  flex: 1 1 auto;
  min-width: 0;
`;

/** The lead-in and the name, as one subject for the heading row to push against. */
const Block__TitleLead = styled.div`
  display: flex;
  align-items: baseline;
  gap: var(--space-6);
  flex: 1 1 auto;
  min-width: 0;
`;

export interface BlockTitleRowProps {
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
}

/**
 * The name's line: an optional lead-in, the name, and the state pushed to the
 * end of it.
 *
 * Built on `SubjectHeading` rather than beside it. That component already owns
 * the rule that a status is drawn after the thing it is a status of, and owning
 * it twice is how the rule breaks in one of the two copies.
 */
function Block__TitleRow({ left, right, children }: BlockTitleRowProps) {
  return (
    <SubjectHeading align="baseline" status={right}>
      {left == null ? (
        children
      ) : (
        <Block__TitleLead>
          {left}
          {children}
        </Block__TitleLead>
      )}
    </SubjectHeading>
  );
}

/**
 * The row the side asides sit in. Wraps, and that wrap IS the collapse: a
 * `left` aside with nowhere to go lands on its own line above the body, a
 * `right` aside below it. Everything still renders; only the arrangement
 * changes.
 *
 * Deliberately not `Panel`'s aside collapse, which hides content behind a
 * disclosure at narrow widths and hid a funds balance once. Deliberately not a
 * container query either: jsdom cannot evaluate one, which is what moved
 * `Panel`'s own collapse onto a measured hook. Flex wrap is laid out by the
 * browser and inspectable in a render.
 */
const Block__Middle = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--gap-related);
`;

/**
 * What the asides sit beside.
 *
 * `--block-body-floor` is the width below which the body stops sharing a line:
 * a real basis rather than zero, because a zero-basis flex child shrinks
 * forever and the row never wraps. A record whose body is a single short
 * figure can lower it.
 */
const Block__Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  flex: 1 1 var(--block-body-floor, 9rem);
  min-width: 0;
`;

/**
 * A block-level aside. The side variants step `--radius-display-frame` down,
 * so a `FramedDisplay` handed to `left` comes out at a corner proportioned to
 * the ~40px box it is being given rather than the one it would take on a map.
 * The frame writes one token and never learns its own size.
 */
const Block__Aside = styled.div<{ $side?: boolean }>`
  min-width: 0;
  ${({ $side }) =>
    $side
      ? `flex: 0 0 auto;
    --radius-display-frame: var(--space-4, 4px);`
      : ""}
`;

/** The actions and tags that close the record. Wraps rather than overflowing. */
const Block__Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

/**
 * The arrangement, with no surface on it. Exported for `Card` and `Notice` to
 * extend with `styled(Block__Root)`, which is what makes each of them literally
 * this plus a surface rather than a second column that resembles it. NOT on the
 * barrel: outside this package the door is `Block`.
 */
export const Block__Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  min-width: 0;
`;

/**
 * Renders the anatomy inside whichever root it is handed. One implementation,
 * so `Card` is `Block` plus a surface rather than a second arrangement that
 * has to be kept in step with this one.
 *
 * Children are direct children of the root while there is no side aside, which
 * is what lets a caller restyle the root's own flex direction (`AlarmsModal`
 * lays its record out as a row) without the anatomy fighting it.
 */
export function renderBlockAnatomy(
  Root: ElementType,
  {
    title,
    titleAs,
    titleLeft,
    titleRight,
    left,
    right,
    top,
    bottom,
    footer,
    children,
    ...rest
  }: BlockAnatomyProps & Record<string, unknown>,
): ReactNode {
  const hasTitleRow = title != null || titleLeft != null || titleRight != null;
  const hasSideAside = left != null || right != null;
  return (
    <Root {...rest}>
      {top != null && <Block__Aside $side={false}>{top}</Block__Aside>}
      {hasTitleRow && (
        <Block__TitleRow left={titleLeft} right={titleRight}>
          <Block__Title as={titleAs}>{title}</Block__Title>
        </Block__TitleRow>
      )}
      {hasSideAside ? (
        <Block__Middle>
          {left != null && <Block__Aside $side>{left}</Block__Aside>}
          <Block__Body>{children}</Block__Body>
          {right != null && <Block__Aside $side>{right}</Block__Aside>}
        </Block__Middle>
      ) : (
        children
      )}
      {footer != null && <Block__Footer>{footer}</Block__Footer>}
      {bottom != null && <Block__Aside $side={false}>{bottom}</Block__Aside>}
    </Root>
  );
}

/**
 * The parts, hung off every surface that composes them.
 *
 * `Card.Title === Block.Title` by construction rather than by discipline: one
 * object, reached through as many doors as there are surfaces. That is the
 * shape `Panel.Section` already uses, an alias and never a second
 * implementation, and it is why the guard that keeps `Panel`'s parts off the
 * barrel has no equivalent here. That guard exists because a second ACCESS PATH
 * to one object lets the parts drift from the whole; an alias has no second
 * object to drift.
 */
export const BLOCK_PARTS = {
  Title: Block__Title,
  TitleRow: Block__TitleRow,
  Body: Block__Body,
  Aside: Block__Aside,
  Footer: Block__Footer,
} as const;

function BlockRoot({ ...props }: BlockProps): ReactNode {
  return renderBlockAnatomy(Block__Root, props);
}

/**
 * The arrangement of a record, and nothing else: a name sized as a name, a body
 * under it, asides on any of four sides, a footer.
 *
 * `Card` is this plus a surface. Nothing wraps anything: a widget that wants the
 * grouping without the sunken box writes `Block`, and one that wants the box
 * writes `Card`. `ContractManager` is the site that proves the split is real,
 * it opted out of the kit entirely to escape the sunken surface and its cards
 * then rendered the same colour as the panel behind them, with no border.
 *
 * The four block-level asides are `left`, `right`, `top` and `bottom`, not
 * `start`/`end`: there is no RTL anywhere in the app, so the logical pair buys
 * a capability nothing uses, and the four-sided logical set reads badly at a
 * call site. `PanelSidebar` keeps `start`/`end` and its real logical CSS.
 *
 * `titleRight` is NOT `right`. The badges on a name's line and the content
 * beside a body are different slots with different collapse behaviour, and
 * collapsing them into one would push a record's badges below its figures the
 * moment the tile narrowed.
 */
export const Block = Object.assign(BlockRoot, BLOCK_PARTS);
