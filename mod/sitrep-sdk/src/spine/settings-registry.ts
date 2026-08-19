import type { Screen } from "./screen";

/**
 * Global registry of user-facing settings. Mirrors the `registerComponent`
 * pattern: features (and Uplinks, via the sitrep-sdk facade) co-locate their
 * own setting definition with the code that consumes it, and `SettingsModal`
 * renders whatever's registered, generically, with no per-mod knowledge.
 *
 * This is the PREFERRED way an Uplink surfaces settings: declare a row here and
 * the app renders + persists it. Reach for a whole custom tab
 * (`registerSettingsTab`, see `./settings-tabs.ts`) only when a setting's UI
 * genuinely can't be expressed as a declarative row, that's the rare escape
 * hatch, not a co-equal default.
 *
 * A setting has one of two BACKINGS (discriminated on `backing`; omitted means
 * `client-pref`):
 *   - `client-pref`: a pure gonogo-side preference persisted to localStorage
 *     via `SettingsService`/`useSetting`. No mod round-trip.
 *   - `source-backed`: read/write route THROUGH an Uplink's `DataSource` to
 *     the mod (e.g. a live config that persists mod-side). The binding closures
 *     are co-located in the client that knows the source's shape; the registry
 *     stores them type-erased (the client owns correctness). No localStorage.
 */

export type SettingType = "boolean";

export interface SettingDefinitionBase {
  id: string;
  label: string;
  description?: string;
  category: string;
  /** Which screens this setting is relevant on. Omit for both. */
  screens?: readonly Screen[];
  /**
   * Id of a parent BOOLEAN setting this one is nested under. Purely a
   * RENDERING/inertness hint for `SettingsModal` (indents the row, disables
   * its `Switch`, and shows it as off, whenever the parent setting reads
   * `false`): the registry itself has no hierarchy concept beyond this one
   * pointer, and does NOT enforce the dependency for consumers reading the
   * child setting directly via `useSetting`. A consuming hook that wants the
   * dependency enforced at the DATA level (not just the UI) must AND-combine
   * both values itself (mirrors `useStationWakeLock`'s own
   * `active && enabled` pattern): see `useMissionHistorySettings` for the
   * concrete example this field was added for.
   */
  dependsOn?: string;
}

/**
 * A localStorage-backed preference: pure gonogo-side, no mod round-trip. The
 * `id` doubles as the localStorage key. This is the default backing; `backing`
 * may be omitted.
 */
export interface ClientPrefSetting extends SettingDefinitionBase {
  backing?: "client-pref";
  type: "boolean";
  defaultValue: boolean;
}

/**
 * A source-backed setting: its value lives on an Uplink's `DataSource`, not in
 * localStorage. `read`/`write`/`subscribe` are the client-supplied binding onto
 * that source (looked up by `sourceId`); the registry stores them type-erased
 * (`source: unknown`), and the consuming row casts to the concrete source type
 * it owns. Only `"boolean"` is built today (rendered as a `Switch`); the union
 * leaves room for `"number"`/`"select"` additively.
 */
export interface SourceBackedSetting extends SettingDefinitionBase {
  backing: "source-backed";
  type: "boolean";
  /** The registered `DataSource` id whose binding this setting reads/writes. */
  sourceId: string;
  read: (source: unknown) => boolean;
  write: (source: unknown, value: boolean) => void;
  subscribe: (source: unknown, cb: () => void) => () => void;
}

export type SettingDefinition = ClientPrefSetting | SourceBackedSetting;

const registry = new Map<string, SettingDefinition>();

export function registerSetting(def: SettingDefinition): void {
  // Idempotent: hot module reload can re-execute registration modules.
  registry.set(def.id, def);
}

/**
 * The registered definition for `id`, or `undefined`. Named `getSettingDefinition`
 * (not `getSetting`) to avoid colliding with the string-valued
 * `getSetting(key)` in `../settings/store.ts`: both are exported from core.
 */
export function getSettingDefinition(
  id: string,
): SettingDefinition | undefined {
  return registry.get(id);
}

export function getAllSettings(): SettingDefinition[] {
  return [...registry.values()];
}

export function getSettingsForScreen(screen: Screen): SettingDefinition[] {
  return getAllSettings().filter(
    (s) => !s.screens || s.screens.includes(screen),
  );
}

export function __clearSettingsForTests(): void {
  registry.clear();
}
