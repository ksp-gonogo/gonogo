import {
  getPartPanelFallbacks,
  getPartPanels,
  onPartPanelsChange,
  type PartPanelDefinition,
} from "@ksp-gonogo/sitrep-sdk";
import { useDomainAvailabilityStore } from "@ksp-gonogo/ui-kit";
import { useMemo, useSyncExternalStore } from "react";

const NO_SUBSCRIBE = (): (() => void) => () => {};

export interface PartPanelRoutes {
  /** The panel that answers this game button, or `undefined` when the button should fire as usual. */
  forGameButton: (
    module: string | null | undefined,
    event: string,
    label: string,
  ) => PartPanelDefinition | undefined;
}

function buttonKey(module: string | null | undefined, event: string): string {
  return `${module ?? ""}\0${event}`;
}

/** The part panels usable right now, looked up by the game button they answer for. */
export function usePartPanelRoutes(): PartPanelRoutes {
  const panels = useSyncExternalStore(
    onPartPanelsChange,
    getPartPanels,
    getPartPanels,
  );
  const fallbacks = useSyncExternalStore(
    onPartPanelsChange,
    getPartPanelFallbacks,
    getPartPanelFallbacks,
  );
  const store = useDomainAvailabilityStore();
  // A counter rather than the availability itself: which Domains matter depends on the panels, and the map below rereads them all.
  const availabilityVersion = useAvailabilityVersion(store);

  // biome-ignore lint/correctness/useExhaustiveDependencies: availabilityVersion is the trigger, the store is read directly.
  return useMemo(() => {
    const isUsable = (panel: PartPanelDefinition) =>
      panel.requires === undefined ||
      (store?.isAvailable(panel.requires) ?? false);
    const usable = panels.filter(isUsable);
    const byButton = new Map<string, PartPanelDefinition>();
    for (const panel of usable) {
      for (const button of panel.replaces ?? []) {
        const key = buttonKey(button.module, button.event);
        if (!byButton.has(key)) byButton.set(key, panel);
      }
    }
    return {
      forGameButton: (module, event, label) => {
        const routed = byButton.get(buttonKey(module, event));
        if (routed) return routed;
        const button = { module: module ?? null, event, label };
        for (const fallback of fallbacks) {
          const panel = fallback(button);
          if (panel && isUsable(panel)) return panel;
        }
        return undefined;
      },
    };
  }, [panels, fallbacks, store, availabilityVersion]);
}

type AvailabilityStore = ReturnType<typeof useDomainAvailabilityStore>;

/** A value that changes each time any Domain's availability does. */
function useAvailabilityVersion(store: AvailabilityStore): number {
  const tracker = useMemo(() => {
    let version = 0;
    return {
      subscribe: (onChange: () => void) =>
        store
          ? store.subscribe(() => {
              version += 1;
              onChange();
            })
          : NO_SUBSCRIBE(),
      read: () => version,
    };
  }, [store]);
  return useSyncExternalStore(tracker.subscribe, tracker.read, tracker.read);
}
