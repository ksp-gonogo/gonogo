import type { ReactNode } from "react";
import { Cluster, type ClusterAlign } from "./Cluster";
import type { SpaceToken } from "./Stack";

export interface SubjectHeadingProps {
  /** What the line is ABOUT: a Program's title, a course's name, a vessel. */
  children: ReactNode;
  /**
   * That subject's state, as a `Badge` or a short run of them. Drawn AFTER the
   * subject and pushed to the end of the line; absent when there is no state
   * worth showing, which leaves the subject alone on the line rather than
   * beside a gap.
   */
  status?: ReactNode;
  /** Gap between the subject and its state. Defaults to `xs`. */
  gap?: SpaceToken;
  /**
   * `align-items`, for a subject that wraps to two lines beside a one-line
   * badge: `start` keeps the badge level with the first line of the name
   * instead of floating in the middle of it.
   */
  align?: ClusterAlign;
}

/**
 * A subject and its state on one line, in that order.
 *
 * <para>The order is the whole point and it is not a knob. A status badge
 * drawn before the thing it is a status OF reads as the state arriving before
 * its subject, both to an eye scanning the line and to a screen reader walking
 * it, which is why the operator ruled that status badges belong above the
 * title or aligned to its right and never in front of it.</para>
 *
 * <para>Two sites had drifted the other way (an RP-1 Program's detail pane and
 * a training course's card) while every other heading in the tree happened to
 * be right, which is what a convention with no home looks like just before it
 * breaks again. This is the home: the order cannot be passed in, so a caller
 * cannot get it wrong.</para>
 *
 * <para>The line WRAPS: a long subject drops its badge onto a second line
 * rather than squeezing the name, because the name is the only part that says
 * which thing the line is about.</para>
 */
export function SubjectHeading({
  children,
  status,
  gap = "xs",
  align = "center",
}: Readonly<SubjectHeadingProps>) {
  return (
    <Cluster align={align} gap={gap} justify="between" wrap>
      {children}
      {status}
    </Cluster>
  );
}
