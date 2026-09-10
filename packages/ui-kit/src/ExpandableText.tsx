import { useId, useState } from "react";
import styled from "styled-components";
import { TextButton } from "./Button";

/**
 * How much prose stands unprompted, in characters. Roughly two lines at the
 * kit's body size in a dashboard column, which is enough to tell one authored
 * paragraph from another without any of them owning the panel.
 */
const DEFAULT_LIMIT = 160;

/**
 * A cut has to be worth its control. Under this much text past the limit the
 * "Show more" button costs the panel more room than the tail it would reveal,
 * so the text simply stands whole instead.
 */
const WORTH_CUTTING = 24;

/**
 * What stands where the cut fell. Three periods rather than the ellipsis
 * character, which the design system does not allow anywhere in the tree.
 */
const CUT_MARK = "...";

export interface ExpandableTextProps {
  /** The authored text, rendered verbatim whether cut or whole. */
  children: string;
  /** Characters shown before the cut. Defaults to 160. */
  limit?: number;
  /**
   * What the prose describes ("Objectives", "Description"). Names the control
   * to a screen reader ("Show more of Objectives") on a screen carrying
   * several of these, where a page of identical "Show more" buttons says
   * nothing about which is which.
   */
  subject?: string;
  className?: string;
}

/**
 * Game-authored prose, cut to a readable length with the rest a button press
 * away.
 *
 * <para>Every string this renders was written for a game's own detail pane and
 * arrives at whatever length its author chose: RP-1's strategy descriptions
 * run past a thousand characters, and a dashboard that prints one under every
 * card it draws is mostly prose. The cut is a CUT, never a summary: what
 * stands is a prefix of the authored string ending on a whole word, and the
 * whole of it is one press away.</para>
 *
 * <para>Cut on a character count rather than a CSS line clamp, because the
 * control has to know whether there is more to show and a clamp only knows
 * that after a layout pass: measured, the button appears a frame late in the
 * app and never at all under jsdom, so nothing could test it. A count decides
 * the same question identically everywhere.</para>
 *
 * <para>The reveal is instantaneous and has nothing to damp under
 * `prefers-reduced-motion`: an expanding paragraph moves whatever sits below
 * it, and animating that is the motion a reduced-motion reader asked not to
 * have.</para>
 */
export function ExpandableText({
  children,
  limit = DEFAULT_LIMIT,
  subject,
  className,
}: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false);
  const proseId = useId();

  const head = cut(children, limit);

  /* Nothing to cut, nothing to wrap it in: prose short enough to stand whole
     renders as the caller's own text node, so putting this round a paragraph
     that never needs it changes neither the markup nor what it inherits. */
  if (head === undefined) return <>{children}</>;

  const verb = expanded ? "Show less" : "Show more";

  return (
    <ExpandableText__Root className={className}>
      <span id={proseId}>{expanded ? children : `${head}${CUT_MARK}`}</span>{" "}
      <ExpandableText__Toggle
        type="button"
        /* A render scene reaches the control by this rather than by a
           generated class name, so an expanded shot survives a restyle. */
        data-expandable-toggle=""
        aria-controls={proseId}
        aria-expanded={expanded}
        aria-label={subject === undefined ? undefined : `${verb} of ${subject}`}
        onClick={() => setExpanded((open) => !open)}
      >
        {verb}
      </ExpandableText__Toggle>
    </ExpandableText__Root>
  );
}

/**
 * The prefix to show, or `undefined` when the text is short enough to stand
 * whole. Cuts on the last space at or before `limit`; a run-on with no space
 * to cut on is cut hard at `limit` rather than shown entire, since that shape
 * is exactly the one that overflows a column.
 */
function cut(text: string, limit: number): string | undefined {
  if (text.length <= limit + WORTH_CUTTING) return undefined;

  const boundary = text.lastIndexOf(" ", limit);
  return boundary <= 0 ? text.slice(0, limit) : text.slice(0, boundary);
}

const ExpandableText__Root = styled.span`
  /* Long authored prose is the one thing on a dashboard likelier than a
     readout to carry a word wider than its column (a part designation, a URL),
     and a column that scrolls sideways to fit one is worse than a broken
     word. */
  overflow-wrap: break-word;
`;

const ExpandableText__Toggle = styled(TextButton)`
  /* Sits on the text's own baseline as the last word of the paragraph rather
     than as a block under it: the cut and the way to undo it read as one
     thing. */
  white-space: nowrap;
`;
