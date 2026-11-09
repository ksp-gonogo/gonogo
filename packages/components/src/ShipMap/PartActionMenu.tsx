import type { AnyBoundCommand } from "@ksp-gonogo/sitrep-sdk";
import type { ActionMenuItem } from "@ksp-gonogo/ui-kit";
import { ActionMenu } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import type { ShipMapPartActionEntry } from "./shipTopology";
import { usePartActions } from "./usePartActions";

const NO_CONTRIBUTED: readonly ShipMapPartActionEntry[] = [];

/** The key a contributed button carries in the menu, kept apart from the game's own event names. */
const CONTRIBUTED_KEY_PREFIX = "contributed:";
const TRANSFER_KEY_PREFIX = "transfer:";
const GAME_WINDOW_KEY_PREFIX = "game-window:";
const NEEDS_THE_GAME_SCREEN = "needs someone at the game's screen";
const OPENS_ON_GAME_SCREEN = "opens on the game's screen";
const NO_RESOURCES: readonly TransferResourceOption[] = [];

/** A resource this part could move, as a menu offers it. */
export interface TransferResourceOption {
  resource: string;
  label: string;
}

const GAME_GREYS_THIS = "the game greys this action";

/** The mod command that fires one PAW button. Must match `PartActionCommandProvider.InvokePartActionCommand`, which `partActions.cs-sync.test.ts` reads out of the C# source. */
export const INVOKE_PART_ACTION_COMMAND = "vessel.invokePartAction";

/**
 * How many actions a part offers ("N actions available") on the hover
 * tooltip. Mounted only while a part is hovered, because mounting subscribes
 * and subscribing makes the mod enumerate that part. Under signal delay the
 * count arrives a signal delay late, so the pending state says so rather than
 * showing "0".
 */
export function PartActionCount({
  flightId,
  contributed = NO_CONTRIBUTED,
}: Readonly<{
  flightId: number;
  /** Buttons contributed to `ship-map.part-actions`, counted with the game's own. */
  contributed?: readonly ShipMapPartActionEntry[];
}>) {
  const { actions, pending } = usePartActions(flightId);
  const count = (actions?.length ?? 0) + contributed.length;

  return (
    <div style={ROW}>
      <span>actions</span>
      <span style={ROW_VALUE}>
        {pending && contributed.length === 0
          ? "checking..."
          : count > 0
            ? `${count} available`
            : "none"}
      </span>
    </div>
  );
}

export interface PartActionMenuProps {
  flightId: number;
  /** The part's display title, for the menu's accessible name and each item's. */
  partTitle: string;
  /** The command one action sends. The widget owns the `useCommand` handle so it outlives the popover, which closes on choice. */
  commandFor: (eventName: string, actionLabel: string) => AnyBoundCommand;
  /** Escape, Tab, an outside press, or a fired action: the caller restores focus to the part. */
  onDismiss: () => void;
  /** Buttons contributed to `ship-map.part-actions` for this part, listed after the game's own. */
  contributed?: readonly ShipMapPartActionEntry[];
  /** The command one contributed button sends, or null where its handle is not mounted. Owned by the widget, like `commandFor`, so its delay row outlives the menu. */
  contributedCommandFor?: (
    entry: ShipMapPartActionEntry,
  ) => AnyBoundCommand | null;
  /** Resources held in this tank that could be transferred, each offered as an entry. */
  transferResources?: readonly TransferResourceOption[];
  /** Starts picking tanks for a transfer of the resource, beginning with this part. */
  onPickTransfer?: (resource: string) => void;
  /** Anchoring, owned by the caller (the diagram knows where the part is). */
  style?: CSSProperties;
}

/**
 * A part's right-click Part Action Window, as an anchored APG menu. Nothing
 * flips optimistically: the delay rail reports a fired action and the list
 * re-renders when the part's live actions change. An inactive action stays
 * selectable and says the game is likely to refuse it, as KSP greys it.
 */
export function PartActionMenu({
  flightId,
  partTitle,
  commandFor,
  onDismiss,
  contributed = NO_CONTRIBUTED,
  contributedCommandFor,
  transferResources = NO_RESOURCES,
  onPickTransfer,
  style,
}: Readonly<PartActionMenuProps>) {
  const { actions, gameWindows, pending } = usePartActions(flightId);

  const items: ActionMenuItem[] = [
    ...(actions ?? []).map((action) => ({
      key: action.name,
      label: action.label || action.name,
      group: action.group ?? undefined,
      advise: action.active ? undefined : GAME_GREYS_THIS,
      command: commandFor(action.name, action.label || action.name),
      tip: action.opensGameWindow ? OPENS_ON_GAME_SCREEN : undefined,
      // The accessible name carries the part, which the item's own text does not.
      "aria-label": `${action.label || action.name} on ${partTitle}`,
    })),
    ...gameWindows.map((action) => ({
      key: `${GAME_WINDOW_KEY_PREFIX}${action.moduleName ?? ""}:${action.name}`,
      label: action.label || action.name,
      group: action.group ?? undefined,
      disabled: true,
      tip: NEEDS_THE_GAME_SCREEN,
      "aria-label": `${action.label || action.name} on ${partTitle}, ${NEEDS_THE_GAME_SCREEN}`,
    })),
    ...contributed.map((entry) => ({
      key: CONTRIBUTED_KEY_PREFIX + entry.name,
      label: entry.label,
      group: entry.group,
      advise: entry.active ? undefined : GAME_GREYS_THIS,
      command: contributedCommandFor?.(entry) ?? undefined,
      "aria-label": `${entry.label} on ${partTitle}`,
    })),
    ...transferResources.map(({ resource, label }) => ({
      key: TRANSFER_KEY_PREFIX + resource,
      label: `${label}...`,
      group: "Transfer",
      "aria-label": `Transfer ${label} from or to ${partTitle}`,
    })),
  ];

  return (
    <ActionMenu
      items={items}
      aria-label={`${partTitle} actions`}
      style={style}
      // An unanswered subscription (a real wait under delay) is not a part with no buttons.
      emptyLabel={
        pending && contributed.length === 0 && transferResources.length === 0
          ? "Awaiting actions..."
          : "No actions"
      }
      // A game or contributed item sends its own command; any choice closes the menu, as a PAW click does, and re-opening re-reads the live list.
      onSelect={(key) => {
        if (key.startsWith(TRANSFER_KEY_PREFIX)) {
          onPickTransfer?.(key.slice(TRANSFER_KEY_PREFIX.length));
        }
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
