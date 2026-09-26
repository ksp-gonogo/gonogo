import { createElement, type ReactNode } from "react";
import { VisuallyHidden } from "./VisuallyHidden";

export interface LiveRegionProps {
  children?: ReactNode;
  /** Names the region, for a region that also holds visible content. */
  "aria-label"?: string;
  /**
   * Keep the region off screen: an announcer, for words assistive tech needs
   * while the visible form of the same fact is drawn somewhere else. An
   * announcer is a bare `aria-live` region rather than a `status`, since it is
   * a channel for announcements and not a part of the page to navigate to.
   */
  visuallyHidden?: boolean;
  /**
   * Announce each addition on its own rather than re-reading the whole region.
   * For a region that collects entries (one per outcome), where a new entry
   * should not repeat every entry before it.
   */
  additionsOnly?: boolean;
  as?: "div" | "span";
  className?: string;
}

/**
 * A polite live region that is in the document before anything is said in it.
 *
 * Assistive tech watches a region for CHANGES from the moment it appears, so a
 * region inserted already holding its first message is often never announced:
 * nothing in it changed. Mount this unconditionally for as long as the thing it
 * reports on is on screen, and put the words in it when there is something to
 * say. Empty, it is silent.
 *
 * Polite only. An interruption is `role="alert"`, which is ABORT's.
 */
export function LiveRegion({
  children,
  "aria-label": ariaLabel,
  visuallyHidden = false,
  additionsOnly = false,
  as = "span",
  className,
}: LiveRegionProps) {
  const props = {
    role: visuallyHidden ? undefined : "status",
    "aria-live": "polite",
    "aria-atomic": additionsOnly ? "false" : "true",
    "aria-label": ariaLabel,
    className,
    "data-live-region": "",
  } as const;
  return visuallyHidden ? (
    <VisuallyHidden as={as} {...props}>
      {children}
    </VisuallyHidden>
  ) : (
    createElement(as, props, children)
  );
}
