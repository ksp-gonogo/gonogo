import type { ActionMenuItem } from "@ksp-gonogo/ui-kit";
import { ActionMenu } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { usePartActions } from "./usePartActions";

/** The mod command that fires one PAW button. Must match `PartActionCommandProvider.InvokePartActionCommand`, which `partActions.cs-sync.test.ts` reads out of the C# source. */
export const INVOKE_PART_ACTION_COMMAND = "vessel.invokePartAction";

/**
 * How many actions a part offers ("N actions available") on the hover
 * tooltip. Mounted only while a part is hovered, because mounting subscribes
 * and subscribing makes the mod enumerate that part. Under signal delay the
 * count arrives a light-time late, so the pending state says so rather than
 * showing "0".
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
  /** Fires one action. The widget owns the `useCommand` handle so it outlives the popover, which closes on fire. */
  onInvoke: (eventName: string, actionLabel: string) => void;
  /** Escape, Tab, an outside press, or a fired action: the caller restores focus to the part. */
  onDismiss: () => void;
  /** Anchoring, owned by the caller (the diagram knows where the part is). */
  style?: CSSProperties;
}

/**
 * A part's right-click Part Action Window, as an anchored APG menu. Nothing
 * flips optimistically: the delay rail reports a fired action and the list
 * re-renders when the part's live actions change. An inactive action renders
 * disabled rather than dropped, as KSP greys it.
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
    group: action.group ?? undefined,
    disabled: !action.active,
    // The accessible name carries the part, which the item's own text does not.
    ariaLabel: `${action.label || action.name} on ${partTitle}`,
  }));

  return (
    <ActionMenu
      items={items}
      ariaLabel={`${partTitle} actions`}
      style={style}
      // An unanswered subscription (a real wait under delay) is not a part with no buttons.
      emptyLabel={pending ? "Awaiting actions..." : "No actions"}
      onSelect={(eventName) => {
        const action = actions?.find((a) => a.name === eventName);
        onInvoke(eventName, action?.label || eventName);
        // Dismiss on fire, like a PAW click; re-opening re-reads the live list.
        onDismiss();
      }}
      onDismiss={onDismiss}
    />
  );
}

const ROW: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--gap-section)",
  color: "var(--color-text-muted)",
};

const ROW_VALUE: CSSProperties = { color: "var(--color-text-primary)" };
