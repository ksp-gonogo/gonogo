import { useCallback, useState } from "react";

export type PlannerTab = "plan" | "flight";

const KEY_PREFIX = "gonogo.maneuver-planner.tab.";

function stored(id: string): PlannerTab {
  try {
    const saved = globalThis.localStorage?.getItem(KEY_PREFIX + id);
    return saved === "flight" ? "flight" : "plan";
  } catch {
    return "plan";
  }
}

/**
 * The tab a one-column planner shows, kept for this widget instance across reloads. Storage can be blocked or absent, in which case the choice lasts as long as the widget is mounted.
 */
export function usePlannerTab(id: string): [PlannerTab, (tab: string) => void] {
  const [tab, setTab] = useState<PlannerTab>(() => stored(id));
  const choose = useCallback(
    (next: string) => {
      const chosen: PlannerTab = next === "flight" ? "flight" : "plan";
      setTab(chosen);
      try {
        globalThis.localStorage?.setItem(KEY_PREFIX + id, chosen);
      } catch {
        // Not persisted; the choice still holds for this mount.
      }
    },
    [id],
  );
  return [tab, choose];
}
