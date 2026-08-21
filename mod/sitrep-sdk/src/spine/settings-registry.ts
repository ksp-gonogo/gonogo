import type { Value } from "../unit-system";
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
 * A row is described on three independent axes.
 *
 * **Backing**: where the value lives, discriminated on `backing` (omitted
 * means `client-pref`):
 *   - `client-pref`: a pure gonogo-side preference persisted to localStorage
 *     via `SettingsService`/`useSetting`. No mod round-trip.
 *   - `source-backed`: read/write route THROUGH an Uplink's `DataSource` to
 *     the mod (e.g. a live config that persists mod-side). The binding closures
 *     are co-located in the client that knows the source's shape; the registry
 *     stores them type-erased (the client owns correctness). No localStorage.
 *   - `stream-backed`: the value arrives on a telemetry Topic and there is no
 *     writer at all. This is what a setting looks like when it is PROVENANCE
 *     rather than preference: a plugin's own configuration, read off the wire,
 *     which the operator needs in order to know what every other number means.
 *
 * **Type**: `boolean`, `text` or `number`, the same three words
 * `AugmentSettingField` already uses. One vocabulary, deliberately: a second
 * union meaning the same thing is how this codebase got a `Panel` in two
 * packages that silently drifted. A `number` row may hand back a `Value`
 * instead of a bare number, and then it renders through `Unit` and announces
 * its unit as a word.
 *
 * **Writability**: `readOnly` renders the value instead of a control. A row
 * whose underlying `Set*` is refused, or which has no writer at all, must
 * declare it: a control offering to change something that cannot change is a
 * lie, and the operator finds out only by trying.
 *
 * **Grouping** is orthogonal to all three. `category` is the heading a row
 * files under; `group` is a named block INSIDE that category, so a mod with
 * forty rows reads as five short lists rather than one wall.
 */

/**
 * What a row's value is. The same three words as `AugmentSettingField["type"]`,
 * and they must stay the same three: see the module header.
 */
export type SettingType = "boolean" | "text" | "number";

/**
 * The value each {@link SettingType} carries.
 *
 * `number` admits a `Value` as well as a bare number because a quantity in this
 * codebase carries its own unit, and a tolerance in metres shown without "m"
 * beside it is the readout this rule exists to stop. Hand back
 * `value("m", 1)` and the row renders through `Unit`.
 */
export interface SettingValueByType {
  boolean: boolean;
  text: string;
  number: number | Value;
}

/** Any value a registered row can carry. */
export type SettingValue = SettingValueByType[SettingType];

export interface SettingDefinitionBase {
  id: string;
  label: string;
  description?: string;
  /** The heading this row files under, e.g. an Uplink's name. */
  category: string;
  /**
   * A named block inside `category`. Rows with no group render first, directly
   * under the category heading, so a category that never used groups looks
   * exactly as it did. Groups then follow in first-registration order, each
   * under its own sub-heading.
   *
   * This exists because a mod's settings are not one list. A trajectory mod's
   * are a plotting frame, a prediction, an analysis window, a drawing budget
   * and a diagnostics block, and reading them as forty-one undifferentiated
   * rows means reading all forty-one to find the one you came for.
   */
  group?: string;
  /** Which screens this setting is relevant on. Omit for both. */
  screens?: readonly Screen[];
  /**
   * The operator cannot change this row: it renders as a labelled VALUE, never
   * as a control. Not a disabled control, which some screen readers skip and
   * which reads as "broken" rather than "informational".
   *
   * Declare it whenever the write does not exist or is refused. A plugin's own
   * configuration read off the wire is the common case, and `stream-backed`
   * rows are read-only whether or not this is set, because they carry no
   * writer to call.
   */
  readOnly?: boolean;
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
 * may be omitted, and so may `type`, which means `"boolean"`.
 */
export interface ClientPrefSettingOf<T extends SettingType>
  extends SettingDefinitionBase {
  backing?: "client-pref";
  type?: T;
  defaultValue: SettingValueByType[T];
}

/**
 * A source-backed setting: its value lives on an Uplink's `DataSource`, not in
 * localStorage. `read`/`subscribe` are the client-supplied binding onto that
 * source (looked up by `sourceId`); the registry stores them type-erased
 * (`source: unknown`), and the consuming row casts to the concrete source type
 * it owns.
 *
 * `write` is what makes the row a control. Omit it (and declare `readOnly`) for
 * a value the source can report but not accept.
 */
export interface SourceBackedSettingOf<T extends SettingType>
  extends SettingDefinitionBase {
  backing: "source-backed";
  type?: T;
  /** The registered `DataSource` id whose binding this setting reads/writes. */
  sourceId: string;
  read: (source: unknown) => SettingValueByType[T];
  write?: (source: unknown, value: SettingValueByType[T]) => void;
  subscribe: (source: unknown, cb: () => void) => () => void;
}

/**
 * A stream-backed setting: the value arrives on a telemetry Topic and the row
 * only ever shows it.
 *
 * This is the shape a mod's own configuration takes. It is not a preference
 * the console owns, and there is no `DataSource` in the middle to bind to: the
 * Uplink already publishes the values on a channel, and inventing a source
 * whose only job is to mirror one topic would be a second copy of the same
 * numbers with nothing saying which is authoritative.
 *
 * Read-only by construction, so `readOnly` is redundant here and the renderer
 * asks {@link isReadOnlySetting} rather than the flag.
 */
export interface StreamBackedSettingOf<T extends SettingType>
  extends SettingDefinitionBase {
  backing: "stream-backed";
  type?: T;
  /** The Topic id whose payload carries this row's value. */
  topic: string;
  /**
   * Pull this row's value out of the Topic payload. Answer `null`/`undefined`
   * when the payload does not carry it and the row shows a null placeholder,
   * which is the honest rendering of "the mod has not said".
   */
  select: (payload: unknown) => SettingValueByType[T] | null | undefined;
  readOnly?: true;
}

/**
 * One row, at one {@link SettingType}. This is the REGISTRATION type: T is
 * inferred from `type` at the call site, which is what makes `defaultValue`,
 * `read`, `write` and `select` agree with each other.
 *
 * Reading the registry back hands you {@link SettingDefinition}, the union over
 * all three types, because the renderer has to cope with whatever was declared.
 */
export type SettingDefinitionOf<T extends SettingType> =
  | ClientPrefSettingOf<T>
  | SourceBackedSettingOf<T>
  | StreamBackedSettingOf<T>;

export type ClientPrefSetting =
  | ClientPrefSettingOf<"boolean">
  | ClientPrefSettingOf<"text">
  | ClientPrefSettingOf<"number">;

export type SourceBackedSetting =
  | SourceBackedSettingOf<"boolean">
  | SourceBackedSettingOf<"text">
  | SourceBackedSettingOf<"number">;

export type StreamBackedSetting =
  | StreamBackedSettingOf<"boolean">
  | StreamBackedSettingOf<"text">
  | StreamBackedSettingOf<"number">;

/** Any registered row, whatever its backing and whatever its type. */
export type SettingDefinition =
  | ClientPrefSetting
  | SourceBackedSetting
  | StreamBackedSetting;

/**
 * Whether the operator can change this row. ONE rule, in one place, because
 * there are two ways for a row to be uncontrollable (declared `readOnly`, or a
 * backing with no writer) and a renderer that checks only the flag would offer
 * a `Switch` on a stream.
 */
export function isReadOnlySetting(def: SettingDefinition): boolean {
  if (def.backing === "stream-backed") return true;
  if (def.readOnly === true) return true;
  return def.backing === "source-backed" && def.write === undefined;
}

/** The declared type of a row, with the boolean default applied. */
export function settingTypeOf(def: SettingDefinition): SettingType {
  return def.type ?? "boolean";
}

const registry = new Map<string, SettingDefinition>();

/**
 * The authoring overload: T is pinned by `type` (absent means `"boolean"`),
 * which is what makes `defaultValue`, `read`, `write` and `select` agree with
 * each other and with the row's declared type.
 */
export function registerSetting<T extends SettingType = "boolean">(
  def: SettingDefinitionOf<T>,
): void;
/**
 * The forwarding overload: a host relaying an already-typed definition it did
 * not author (`GonogoHost.registerSetting`) has no `type` literal left to infer
 * from, only the union.
 */
export function registerSetting(def: SettingDefinition): void;
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
