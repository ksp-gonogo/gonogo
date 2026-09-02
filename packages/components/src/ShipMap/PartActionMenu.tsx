import type { ActionMenuItem } from "@ksp-gonogo/ui-kit";
import { ActionMenu } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { usePartActions } from "./usePartActions";

/**
 * The mod command that fires one PAW button. MUST match
 * `PartActionCommandProvider.InvokePartActionCommand`
 * (mod/Sitrep.Host/PartActionCommandProvider.cs); `PartActionMenu.test.tsx`
 * asserts the string.
 */
export const INVOKE_PART_ACTION_COMMAND = "vessel.invokePartAction";

/**
 * How many actions a part currently offers, as the WW spec's discoverability
 * line ("N actions available") on the hover tooltip: the operator learns a part
 * is actionable before committing to opening anything.
 *
 * <p>Its own component, mounted only while a part is hovered, because MOUNTING is
 * what subscribes, and subscribing is what makes the mod enumerate that part (see
 * `usePartActions`). Hovering one part therefore enumerates exactly one part.</p>
 *
 * <p>Under signal delay the count itself arrives a light-time after the hover, so
 * the pending state says so rather than showing a confident "0".</p>
 */
export function PartActionCount({ flightId }: Readonly<{ flightId: number }>) {
  const { actions, pending } = usePartActions(flightId);

  return (
    <div style={ROW}>
      <span>actions</span>
      <span style={ROW_VALUE}>
        {pending
          ? "checking..."
          : actions && actions.length > 0
            ? `${actions.length} available`
            : "none"}
      </span>
    </div>
  );
}

export interface PartActionMenuProps {
  flightId: number;
  /** The part's display title, for the menu's accessible name and each item's. */
  partTitle: string;
  /**
   * Fires one action. Owned by the widget rather than this menu because the
   * `useCommand` handle must OUTLIVE the popover: the menu closes on fire (like
   * a real PAW click), and a handle that unmounted with it would take its
   * in-flight delay row along with it. The widget holds the handle and feeds the
   * Panel's delay rail, so a fired action stays visible while it travels.
   */
  onInvoke: (eventName: string, actionLabel: string) => void;
  /** Escape, Tab, an outside press, or a fired action: the caller restores focus to the part. */
  onDismiss: () => void;
  /** Anchoring, owned by the caller (the diagram knows where the part is). */
  style?: CSSProperties;
}

/**
 * A part's right-click Part Action Window, as an anchored APG menu.
 *
 * <p><b>Nothing here flips state optimistically.</b> A fired action is reported
 * by the widget's delay rail, and the button set itself re-renders when the
 * part's live action list changes (Extend becoming Retract, one light-time
 * later). Guessing the outcome locally would show the operator a state the craft
 * has not reached.</p>
 *
 * <p>An inactive action (`active: false`) renders disabled rather than being
 * dropped: KSP greys an inert PAW button rather than removing it, and a list that
 * reshuffled itself as craft state changed would be harder to use, not easier.</p>
 */
export function PartActionMenu({
  flightId,
  partTitle,
  onInvoke,
  onDismiss,
  style,
}: Readonly<PartActionMenuProps>) {
  const { actions, pending } = usePartActions(flightId);

  const items: ActionMenuItem[] = (actions ?? []).map((action) => ({
    key: action.name,
    label: action.label || action.name,
    group: action.group,
    disabled: !action.active,
    // The part title is not in the item's own text, so a screen-reader user
    // hearing just "Extend Solar Panel" would not know which part it acts on.
    // The accessible name carries both.
    ariaLabel: `${action.label || action.name} on ${partTitle}`,
  }));

  return (
    <ActionMenu
      items={items}
      ariaLabel={`${partTitle} actions`}
      style={style}
      // Two different empty states: a subscription that has not been answered
      // yet (a real wait under signal delay) versus a part that genuinely has no
      // buttons. Collapsing them would report "none" for a part still in transit.
      emptyLabel={pending ? "Awaiting actions..." : "No actions"}
      onSelect={(eventName) => {
        const action = actions?.find((a) => a.name === eventName);
        onInvoke(eventName, action?.label || eventName);
        // Dismiss on fire, matching a real PAW click. Re-opening re-reads the
        // live list, so the operator sees the post-command state rather than a
        // stale snapshot held open.
        onDismiss();
      }}
      onDismiss={onDismiss}
    />
  );
}

const ROW: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--space-12)",
  color: "var(--color-text-muted)",
};

const ROW_VALUE: CSSProperties = { color: "var(--color-text-primary)" };
