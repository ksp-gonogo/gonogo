import { createContext, type ReactNode, useContext, useMemo } from "react";

/*
 * Augment settings are a framework capability: any augment may declare them,
 * the values live in the HOST WIDGET INSTANCE's config under
 * `augmentSettings[<augmentId>]`, the host provides once and any augment reads
 * with a hook, so segment slots stay propless.
 */

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
 * Publishes the mounting widget instance's augment settings. The dashboard
 * mounts it for every widget; outside the dashboard there is no provider and
 * augments read the absent case.
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
 * writer scoped to that augment. Pass the id `registerAugment` was called with.
 *
 * Outside a provider the values read empty and the writer is a no-op, the same
 * as an operator having saved nothing.
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
