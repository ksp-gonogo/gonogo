import { createContext, type ReactNode, useContext, useMemo } from "react";

/*
 * Augment settings are a framework capability: any augment may declare them,
 * the values live in the HOST WIDGET INSTANCE's config under
 * `augmentSettings[<augmentId>]`, the host provides once and any augment reads
 * with a hook, so segment slots stay propless.
 */

/**
 * What {@link AugmentSettingsProvider} publishes: the widget instance's saved
 * augment settings and a writer for them.
 *
 * @category Extensions
 */
export interface AugmentSettingsContextValue {
  /**
   * The host widget instance's saved per-augment settings, keyed
   * `[augmentId][fieldKey]`: the same namespacing {@link getAugmentSettings} and
   * {@link AugmentSettingsPanel} use. `undefined` for a field nothing has saved yet,
   * so an augment falls back to its own declared `default`.
   */
  settings: Record<string, Record<string, unknown>> | undefined;
  /**
   * Persists one field of one augment's settings into the host widget
   * instance's own config, the same place the settings panel writes, so a
   * quick toggle in an `actions` augment and the settings panel always agree.
   */
  setAugmentSetting: (augmentId: string, key: string, value: unknown) => void;
}

const AugmentSettingsContext =
  createContext<AugmentSettingsContextValue | null>(null);

/**
 * Publishes a widget instance's augment settings, stored in its config under
 * `augmentSettings[<augmentId>]`, to the augments rendered inside it. The
 * dashboard mounts one for every widget; outside the dashboard there is none,
 * and {@link useAugmentSettings} reads empty values.
 *
 * @category Extensions
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
 * One augment's own settings for the widget instance it is rendered in, plus a
 * writer scoped to that augment. Pass the `id` the augment was registered
 * with. A field nothing has saved is missing from `values`, so fall back to
 * the field's declared `default`.
 *
 * Outside an {@link AugmentSettingsProvider} the values read empty and `set`
 * does nothing, the same as an operator having saved nothing.
 *
 * @example
 * ```tsx
 * const { values, set } = useAugmentSettings("example-cadence-section");
 * const compact = values.compact === true;
 * <Switch checked={compact} onChange={(v) => set("compact", v)} label="Compact" />
 * ```
 *
 * @category Extensions
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
 * The whole per-augment settings map for the current widget instance, keyed
 * `[augmentId][fieldKey]`, or `undefined` outside a provider or before
 * anything is saved. For a widget reasoning across all its augments, such as
 * drawing its settings panel or compositing only the layers switched on.
 *
 * @category Extensions
 */
export function useAllAugmentSettings():
  | Record<string, Record<string, unknown>>
  | undefined {
  return useContext(AugmentSettingsContext)?.settings;
}

const EMPTY_VALUES: Record<string, unknown> = Object.freeze({});
