import type { ElementType, HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { SubjectHeading } from "./SubjectHeading";

/**
 * A record's anatomy, as props: a name, badges on the name's line, a body of
 * figures, asides and a footer of actions. Props are the primary form; the
 * compound parts are the escape hatch for a widget that needs a unique
 * expression and still wants the family's type and spacing.
 */
export interface BlockAnatomyProps {
  /**
   * The name this record is about, drawn as a heading: larger and heavier than
   * the body under it. Replaces the HTML `title` tooltip attribute.
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
   * it. Distinct from `right`, which sits beside (or below) the whole body.
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

/** The name, sized as one. Type belongs to the arrangement, so `Card.Title` is this same object. */
const Block__Title = styled.div`
  color: var(--color-text-primary);
  font-weight: 600;
  /* One rung above the body the arrangement sets, which is the whole of what
     "the title is bigger than the text underneath it" means. Both sides are
     the arrangement's, and they have to be: a title alone cannot be bigger
     than a body it does not know. At this rung with the body left inherited,
     the name of a part came out SMALLER than the sentence under it in the
     fleet roster, which is the complaint inverted rather than fixed.

     A relative em step was the other candidate and it is worse: em measures
     against the INHERITED size, not the sibling body, so a record inside a
     panel came out at 15px and out-sized the panel's own 11px heading.

     The title is what the record's caption points at and the body under it is
     scanned, so the two halves of the step are the value size over the compact
     one. The arrangement declares both, because a relation only one side
     states is one a site can break by restating the other. */
  font-size: var(--font-size-value);
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
  gap: var(--gap-record-lead);
  flex: 1 1 auto;
  min-width: 0;
`;

export interface BlockTitleRowProps {
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
}

/** The name's line: an optional lead-in, the name, and the state pushed to the end, via `SubjectHeading`. */
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
 * The row the side asides sit in. The wrap IS the collapse: a `left` aside with
 * nowhere to go lands above the body, a `right` aside below it. Nothing is ever
 * hidden, unlike `Panel`'s aside.
 */
const Block__Middle = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--gap-related);
`;

/**
 * What the asides sit beside. `--block-body-floor` is the width below which the
 * body stops sharing a line; a zero basis would shrink forever and never wrap.
 */
const Block__Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  flex: 1 1 var(--block-body-floor, 9rem);
  min-width: 0;
`;

/** A block-level aside. The side variants step `--radius-display-frame` down, so a `FramedDisplay` in `left` gets a corner proportioned to its small box. */
const Block__Aside = styled.div<{ $side?: boolean }>`
  min-width: 0;
  ${({ $side }) =>
    $side
      ? `flex: 0 0 auto;
    --radius-display-frame: var(--radius-display-frame-aside);`
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

/** The arrangement with no surface. `Card` and `Notice` extend it; outside this package the door is `Block`. */
export const Block__Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  min-width: 0;
  /* The compact body a record is written in, and the other half of the title's
     relation above. Declared here rather than left inherited so the step holds
     without every site restating it: a widget whose rows carry no size of
     their own took the panel's, and a prose sentence under a 12px name is the
     hierarchy upside down. A row that means to be larger still says so. */
  font-size: var(--font-size-compact);
`;

/**
 * Renders the anatomy inside whichever root it is handed. Children are direct
 * children of the root while there is no side aside, so a caller may restyle
 * the root's flex direction.
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

/** The parts, hung off every surface that composes them: `Card.Title === Block.Title`. */
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
 * under it, asides on any of four sides, a footer. `Card` is this plus a
 * sunken surface.
 *
 * `titleRight` is NOT `right`: badges on the name's line and content beside
 * the body collapse differently.
 */
export const Block = Object.assign(BlockRoot, BLOCK_PARTS);
