import type { Strategy } from "./index";

/**
 * The Administration Building's SCREENS: which ones exist, what they are called,
 * and which strategy departments each of them lists.
 *
 * <para>The widget draws a facility, and a facility's screens belong to the
 * elected career model rather than to the widget: RP-1's building has Programs
 * and Leaders where a stock one has neither. So the list arrives as a
 * CONTRIBUTION, computed from Topics and therefore deterministic, and the widget
 * owns only the tab strip. Deriving the strip from whichever bodies happened to
 * register instead would make it a race, since an Uplink's client bundle is
 * fetched at runtime and a bundle that arrives late or never would silently take
 * a screen with it, with nothing left to say a screen was ever meant to be
 * there.</para>
 *
 * <para>Mirrored as `StrategiesScreenEntry` in `mod/sitrep-sdk`'s
 * `api/contribution-slots.ts`, which is the copy an Uplink types against, the
 * same way `ShipMapPartMeterEntry` is mirrored for `ship-map.part-meters`.</para>
 */
export interface StrategiesScreenEntry {
  id: string;
  label: string;
  order?: number;
  departments?: readonly string[];
  enabled?: boolean;
  disabledReason?: string;
}

/** One screen as the widget draws it, after the contributions are resolved. */
export interface ResolvedScreen {
  id: string;
  label: string;
  /** Non-null for a screen that exists and cannot be opened, carrying why. */
  lockedReason: string | null;
  /**
   * True when the screen claims exactly one department, which makes the per-card
   * department chip the tab's own name repeated onto every card in it. False for
   * the trailing screen, whose label names no department, and for a screen
   * gathering several.
   */
  namesOneDepartment: boolean;
  /** The strategies this screen lists, in the order the career reported them. */
  strategies: Strategy[];
}

/**
 * The trailing screen for strategies no contributed screen claims.
 *
 * A contributor naming Programs and nothing else would otherwise take the other
 * sixty rows of an RP-1 career off the widget entirely, and a building that
 * quietly stops showing most of its own contents is the failure the whole
 * contribution model is aimed at. The screen exists only while something is
 * unclaimed, so it empties out and disappears as the remaining screens land.
 */
export const UNCLAIMED_SCREEN_ID = "strategies.unclaimed";

/** How a screen with no `order` sorts: after every screen that states one. */
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

  // First entry wins a repeated id. Contribution ids are globally unique but
  // two clients can still reach for the same screen id, and a tab strip with
  // two tabs of one name is worse than the one that got there first.
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
        ? // A locked screen with no reason still has to say it is locked: the
          // operator is looking at a tab that will not open either way.
          (entry.disabledReason ?? "Not available yet")
        : null,
    namesOneDepartment: (entry.departments ?? []).length === 1,
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
      strategies: unclaimed,
    });
  }

  return screens;
}
