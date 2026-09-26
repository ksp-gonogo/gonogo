import type { ReactNode } from "react";
import { Cluster, type ClusterAlign } from "./Cluster";
import type { GapToken } from "./scales";

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
  /** Gap between the subject and its state. Defaults to `related-packed`. */
  gap?: GapToken;
  /**
   * `align-items`, for a subject that wraps to two lines beside a one-line
   * badge: `start` keeps the badge level with the first line of the name
   * instead of floating in the middle of it.
   */
  align?: ClusterAlign;
}

/**
 * A subject and its state on one line, in that order, which is not a knob: a
 * badge drawn before the thing it is a status of reads as the state arriving
 * before its subject, to an eye and to a screen reader.
 *
 * The line wraps: a long subject drops its badge onto a second line rather
 * than squeezing the name.
 */
export function SubjectHeading({
  children,
  status,
  gap = "related-packed",
  align = "center",
}: Readonly<SubjectHeadingProps>) {
  return (
    <Cluster align={align} gap={gap} justify="between" wrap>
      {children}
      {status}
    </Cluster>
  );
}
