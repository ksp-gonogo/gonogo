import { createElement, type ReactNode } from "react";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * Props of {@link LiveRegion}.
 *
 * @category Typography
 */
export interface LiveRegionProps {
  /** The words to announce; leave empty until there is something to say. */
  children?: ReactNode;
  /** Names the region, for a region that also holds visible content. */
  "aria-label"?: string;
  /**
   * Keep the region off screen: an announcer, a bare `aria-live` region rather
   * than a `status`, for words whose visible form is drawn somewhere else.
   */
  visuallyHidden?: boolean;
  /**
   * Announce each addition on its own rather than re-reading the whole region.
   * For a region that collects entries (one per outcome), where a new entry
   * should not repeat every entry before it.
   */
  additionsOnly?: boolean;
  /**
   * Interrupt rather than announce: `aria-live="assertive"`, and `role="alert"`
   * where the region is on screen. Only for states that must interrupt
   * whatever the operator is doing, such as a mission abort, and nothing softer.
   */
  assertive?: boolean;
  /** The element the region renders as. */
  as?: "div" | "span";
  /** A class for the region's element, so a styled-component can extend it. */
  className?: string;
}

/**
 * A live region that is in the document before anything is said in it.
 *
 * Assistive tech announces changes to a region, so one inserted already holding
 * its message is often never announced. Mount this for as long as the thing it
 * reports on is on screen, and put the words in when there is something to say.
 *
 * Polite unless `assertive`, which interrupts and is kept for states that must
 * interrupt, such as a mission abort.
 *
 * @example Mounted with the control, empty until there is an outcome to say
 * ```tsx
 * import { Button, LiveRegion } from "@ksp-gonogo/ui-kit";
 * import { useState } from "react";
 *
 * function Deploy(props: { onDeploy: () => Promise<void> }) {
 *   const [outcome, setOutcome] = useState("");
 *   const deploy = () =>
 *     props.onDeploy().then(
 *       () => setOutcome("Deployed"),
 *       () => setOutcome("Deploy refused"),
 *     );
 *   return (
 *     <>
 *       <Button onClick={() => void deploy()}>Deploy</Button>
 *       <LiveRegion>{outcome}</LiveRegion>
 *     </>
 *   );
 * }
 * ```
 *
 * @category Typography
 */
export function LiveRegion({
  children,
  "aria-label": ariaLabel,
  visuallyHidden = false,
  additionsOnly = false,
  assertive = false,
  as = "span",
  className,
}: LiveRegionProps) {
  const visibleRole = assertive ? "alert" : "status";
  const props = {
    role: visuallyHidden ? undefined : visibleRole,
    "aria-live": assertive ? "assertive" : "polite",
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
