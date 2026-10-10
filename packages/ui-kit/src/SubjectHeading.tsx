import type { ReactNode } from "react";
import { Cluster, type ClusterAlign } from "./Cluster";
import type { GapToken } from "./scales";

/**
 * Props for {@link SubjectHeading}.
 *
 * @category Typography
 */
export interface SubjectHeadingProps {
  /** What the line is about: a program's title, a course's name, a vessel. */
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
 * A subject and its state on one line, subject first and the state pushed to
 * the end. The order is fixed, so the state always reads after the thing it
 * describes, to an eye and to a screen reader.
 *
 * The line wraps: a long subject drops its badge onto a second line rather
 * than squeezing the name.
 *
 * @example
 * ```tsx
 * <SubjectHeading
 *   status={
 *     <Badge tone="go">Active</Badge>
 *   }
 * >
 *   <Text weight="semibold">{program.title}</Text>
 * </SubjectHeading>
 * ```
 *
 * @category Typography
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
