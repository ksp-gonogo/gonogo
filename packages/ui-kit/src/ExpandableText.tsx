import { useId, useState } from "react";
import styled from "styled-components";
import { TextButton } from "./Button";

/**
 * How much prose stands unprompted, in characters: roughly two lines at the
 * kit's body size in a dashboard column.
 */
const DEFAULT_LIMIT = 160;

/**
 * Under this much text past the limit the "Show more" button costs more room
 * than the tail it would reveal, so the text stands whole.
 */
const WORTH_CUTTING = 24;

/**
 * Three periods rather than the ellipsis character, which the design system
 * does not allow.
 */
const CUT_MARK = "...";

/**
 * Props for {@link ExpandableText}.
 *
 * @category Typography
 */
export interface ExpandableTextProps {
  /** The authored text, rendered verbatim whether cut or whole. */
  children: string;
  /** Characters shown before the cut. Defaults to 160. */
  limit?: number;
  /**
   * What the prose describes ("Objectives", "Description"), naming the control
   * to a screen reader as "Show more of Objectives".
   */
  subject?: string;
  className?: string;
}

/**
 * Game-authored prose, cut to a readable length with the rest behind a
 * "Show more" button.
 *
 * The cut is a prefix of the string ending on a whole word, followed by
 * `...`; text with no space before `limit` is cut hard at `limit`. It is a character count, not
 * a CSS line clamp. Text no more than 24 characters past `limit` is shown
 * whole with no button, as a bare text node. The reveal is instantaneous.
 *
 * @category Typography
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

  // Prose short enough to stand whole renders as the caller's own text node.
  if (head === undefined) return <>{children}</>;

  const verb = expanded ? "Show less" : "Show more";

  return (
    <ExpandableText__Root className={className}>
      <span id={proseId}>{expanded ? children : `${head}${CUT_MARK}`}</span>{" "}
      <ExpandableText__Toggle
        type="button"
        /* A stable hook for a render scene, rather than a generated class name. */
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
 * is cut hard at `limit`.
 */
function cut(text: string, limit: number): string | undefined {
  if (text.length <= limit + WORTH_CUTTING) return undefined;

  const boundary = text.lastIndexOf(" ", limit);
  return boundary <= 0 ? text.slice(0, limit) : text.slice(0, boundary);
}

const ExpandableText__Root = styled.span`
  /* Long prose may carry a word wider than its column, and a broken word beats a sideways scroll. */
  overflow-wrap: break-word;
`;

const ExpandableText__Toggle = styled(TextButton)`
  /* Sits on the text's baseline as the paragraph's last word, so the cut and its undo read as one. */
  white-space: nowrap;
`;
