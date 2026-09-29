import type { Strategy } from "./index";

/**
 * One Administration Building screen: its name and the strategy departments it
 * lists. Screens belong to the career model, not the widget, so they arrive as
 * a contribution computed from Topics rather than from whichever bodies happened
 * to register. Mirrored in the sdk's `api/contribution-slots.ts`, the copy an
 * Uplink types against.
 */
export interface StrategiesScreenEntry {
  id: string;
  label: string;
  order?: number;
  departments?: readonly string[];
  enabled?: boolean;
  disabledReason?: string;
  /**
   * True when the screen's own body already carries the activate/deactivate
   * verbs for its cards (RP-1's Programs screen offers Accept and Complete
   * through its `strategies.screen-body` augment). The host then draws that
   * screen's Active and Available cards with no Activate or Deactivate button
   * of its own, rather than one that could only ever be refused.
   */
  drawsOwnActions?: boolean;
}

/** One screen as the widget draws it, after the contributions are resolved. */
export interface ResolvedScreen {
  id: string;
  label: string;
  /** Non-null for a screen that exists and cannot be opened, carrying why. */
  lockedReason: string | null;
  /** True when the screen claims exactly one department, so a per-card department chip would repeat the tab's name. */
  namesOneDepartment: boolean;
  /**
   * False for a screen naming no departments: it lists nothing and is chrome
   * for its augment body, so the host draws no Active/Available/Locked
   * sections at all rather than an empty-looking building.
   */
  listsStrategies: boolean;
  /** Mirrors {@link StrategiesScreenEntry.drawsOwnActions}. */
  drawsOwnActions: boolean;
  /** The strategies this screen lists, in the order the career reported them. */
  strategies: Strategy[];
}

/**
 * The trailing screen for strategies no contributed screen claims, so a partial
 * set of screens never hides the rest of the building. It exists only while
 * something is unclaimed.
 */
export const UNCLAIMED_SCREEN_ID = "strategies.unclaimed";

const UNORDERED = Number.POSITIVE_INFINITY;

/**
 * Resolve the contributed screens against the career's strategy list.
 *
 * Returns empty for an empty contribution, which is the signal to draw the
 * ungrouped widget: one tab over the whole list is chrome that says nothing.
 */
export function resolveScreens(
  contributed: readonly StrategiesScreenEntry[],
  strategies: readonly Strategy[],
): ResolvedScreen[] {
  if (contributed.length === 0) return [];

  // First entry wins a repeated screen id.
  const seen = new Set<string>();
  const unique: StrategiesScreenEntry[] = [];
  for (const entry of contributed) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    unique.push(entry);
  }

  const ordered = unique
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        (a.entry.order ?? UNORDERED) - (b.entry.order ?? UNORDERED) ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);

  const claimed = new Set<string>();
  for (const entry of ordered) {
    for (const department of entry.departments ?? []) claimed.add(department);
  }

  const screens: ResolvedScreen[] = ordered.map((entry) => ({
    id: entry.id,
    label: entry.label,
    lockedReason:
      entry.enabled === false
        ? // A locked screen with no reason still has to say it is locked.
          (entry.disabledReason ?? "Not available yet")
        : null,
    namesOneDepartment: (entry.departments ?? []).length === 1,
    listsStrategies: (entry.departments ?? []).length > 0,
    drawsOwnActions: entry.drawsOwnActions === true,
    strategies: strategies.filter((s) =>
      (entry.departments ?? []).includes(s.departmentName),
    ),
  }));

  const unclaimed = strategies.filter((s) => !claimed.has(s.departmentName));
  if (unclaimed.length > 0) {
    screens.push({
      id: UNCLAIMED_SCREEN_ID,
      label: "Other",
      lockedReason: null,
      namesOneDepartment: false,
      // The trailing screen always has real, unclaimed strategies to show.
      listsStrategies: true,
      drawsOwnActions: false,
      strategies: unclaimed,
    });
  }

  return screens;
}
