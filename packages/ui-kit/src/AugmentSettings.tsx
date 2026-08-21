import { createContext, type ReactNode, useContext, useMemo } from "react";

// ---------------------------------------------------------------------------
// Augment settings, as a framework capability rather than a widget's prop.
//
// `registerAugment({ settings })` (spec §4.7) is the framework's: any augment
// on any widget may declare settings, `AugmentSettingsPanel` renders them all
// the same way, and the values live in the HOST WIDGET INSTANCE's saved config
// under `augmentSettings[<augmentId>]`. Nothing about that is MapView's, and
// yet MapView is where it was: two of its slots threaded
// `augmentSettings` down as slot props and one threaded a `setAugmentShow`
// writer alongside it, because there was nowhere else for a framework
// capability to live.
//
// That cost more than duplication. A slot passing the settings system down is
// a slot only augments of THAT widget can reach it through, so the capability
// stopped at whichever widget had bothered to thread it; and it made the
// props of `map-view.actions` different from `system-view.actions`, which is
// the whole reason the two could not be one universal segment.
//
// Here instead: the host provides once, any augment reads with a hook, and a
// segment slot stays propless.
// ---------------------------------------------------------------------------

export interface AugmentSettingsContextValue {
  /**
   * The host widget instance's saved per-augment settings, keyed
   * `[augmentId][fieldKey]`: the same namespacing `getAugmentSettings` and
   * `AugmentSettingsPanel` use. `undefined` for a field nothing has saved yet,
   * so an augment falls back to its own declared `default`.
   */
  settings: Record<string, Record<string, unknown>> | undefined;
  /**
   * Persists one field of one augment's settings into the host widget
   * instance's own config. The settings panel and a quick toggle in a
   * `actions` augment therefore write the same place and can never disagree.
   */
  setAugmentSetting: (augmentId: string, key: string, value: unknown) => void;
}

const AugmentSettingsContext =
  createContext<AugmentSettingsContextValue | null>(null);

/**
 * Publishes the mounting widget instance's augment settings. Mounted by the
 * dashboard for every widget, so a widget wires nothing; a widget rendered
 * outside the dashboard (a test, a probe, the settings modal) simply has no
 * provider and its augments read the absent case.
 */
export function AugmentSettingsProvider({
  settings,
  setAugmentSetting,
  children,
}: AugmentSettingsContextValue & { children?: ReactNode }) {
  const value = useMemo(
    () => ({ settings, setAugmentSetting }),
    [settings, setAugmentSetting],
  );
  return (
    <AugmentSettingsContext.Provider value={value}>
      {children}
    </AugmentSettingsContext.Provider>
  );
}

/**
 * One augment's own settings for the widget instance it is mounted in, plus a
 * writer scoped to that augment. Pass the augment's registered id, the same id
 * `registerAugment` was called with and the same one the settings are
 * namespaced under: an augment reading another's settings is not a thing this
 * exists to allow.
 *
 * Outside a provider the values read empty and the writer is a no-op, so an
 * augment rendered in isolation behaves as one whose operator has saved
 * nothing, which is the state it must already handle.
 */
export function useAugmentSettings(augmentId: string): {
  /** This augment's saved fields; empty when nothing has been saved. */
  values: Record<string, unknown>;
  /** Persists one of this augment's fields into the host widget's config. */
  set: (key: string, value: unknown) => void;
} {
  const ctx = useContext(AugmentSettingsContext);
  const settings = ctx?.settings;
  const setAugmentSetting = ctx?.setAugmentSetting;
  return useMemo(
    () => ({
      values: settings?.[augmentId] ?? EMPTY_VALUES,
      set: (key: string, value: unknown) =>
        setAugmentSetting?.(augmentId, key, value),
    }),
    [settings, setAugmentSetting, augmentId],
  );
}

/**
 * The whole per-augment settings map for the mounting widget instance, for a
 * HOST that must reason across augments rather than about its own: rendering
 * the settings panel, or compositing only the layers currently switched on.
 */
export function useAllAugmentSettings():
  | Record<string, Record<string, unknown>>
  | undefined {
  return useContext(AugmentSettingsContext)?.settings;
}

const EMPTY_VALUES: Record<string, unknown> = Object.freeze({});
