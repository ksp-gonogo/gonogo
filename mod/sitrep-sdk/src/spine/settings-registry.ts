import type { TopicId, TopicPayloadMap } from "../topics";
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
 * What a row's value is: the same three words {@link AugmentSettingField}
 * uses for its `type`.
 *
 * @category Settings
 */
export type SettingType = "boolean" | "text" | "number";

/**
 * The value each {@link SettingType} carries. A `"number"` row may hold a
 * `Value`, such as `value("m", 1)`, so it is drawn with its unit.
 *
 * @category Settings
 */
export interface SettingValueByType {
  /** A switch. */
  boolean: boolean;
  /** A line of text. */
  text: string;
  /** A number, bare or as a `Value` with its unit. */
  number: number | Value;
}

/**
 * Any value a registered row can carry.
 *
 * @category Settings
 */
export type SettingValue = SettingValueByType[SettingType];

/**
 * What every registered settings row carries, whatever its backing and type.
 *
 * @category Settings
 */
export interface SettingDefinitionBase {
  /** The setting's key, unique across every Uplink. It is what `useSetting` takes, and what a saved value is stored under, so keep it stable. */
  id: string;
  /** The row's name, as the operator reads it. */
  label: string;
  /** A sentence under the label saying what the setting changes. */
  description?: string;
  /** The heading this row files under, e.g. an Uplink's name. */
  category: string;
  /**
   * A named block within `category`, drawn under its own sub-heading. Rows with
   * no group come first, directly under the category heading; groups follow in
   * the order they were first registered. Use groups to break a long list of a
   * mod's settings into parts a reader can find their way through.
   */
  group?: string;
  /** Which screens this setting is relevant on. Omit for every screen. */
  screens?: readonly Screen[];
  /**
   * The Uplink this row belongs to, by its id. The Settings window has a
   * General tab for the app's own settings and an Uplinks tab with a page for
   * each Uplink. With this set, the row is drawn on that Uplink's page, below
   * the settings its mod reports, rather than under its `category` in General.
   */
  uplink?: string;
  /**
   * The operator cannot change this row: it is drawn as a labelled value, not as
   * a disabled control. Set it on a setting your client stores and the
   * operator must not change. A setting read from a Topic is read-only
   * whether or not this is set, so there it changes nothing.
   */
  readOnly?: boolean;
  /**
   * The id of a boolean setting this one is nested under. Settings indents
   * the row, and disables it and shows it off while the parent is `false`.
   * That is all it does: {@link useSetting} still returns the row's own
   * value, so code that should obey the parent reads both and combines them.
   */
  dependsOn?: string;
}

/**
 * A setting saved in this browser's `localStorage`, under its `id`. This is the
 * default: `backing` may be left out, and so may `type`, which then means
 * `"boolean"`.
 *
 * @category Settings
 */
export interface ClientPrefSettingOf<SettingKind extends SettingType>
  extends SettingDefinitionBase {
  /** Where the value is kept: `"client-pref"`, this browser. The default, so it may be left out. */
  backing?: "client-pref";
  /** The kind of value: `"boolean"` (the default when left out), `"text"` or `"number"`. Sets the control drawn. */
  type?: SettingKind;
  /** The value the row holds until the operator changes it. */
  defaultValue: SettingValueByType[SettingKind];
}

/**
 * A setting whose value arrives on a Topic, which the row only shows: a mod's
 * own configuration, as its Uplink publishes it.
 *
 * It cannot be changed from the row whatever its `readOnly` says, so ask
 * {@link isReadOnlySetting} whether a row can be changed rather than reading
 * the flag.
 *
 * @category Settings
 */
export interface StreamBackedSettingOf<
  SettingKind extends SettingType,
  Topic extends TopicId = TopicId,
> extends SettingDefinitionBase {
  /** Where the value comes from: `"stream-backed"`, a Topic. */
  backing: "stream-backed";
  /** The kind of value: `"boolean"` (the default when left out), `"text"` or `"number"`. Sets how the value is drawn. */
  type?: SettingKind;
  /** The Topic id whose payload carries this row's value. */
  topic: Topic;
  /**
   * Returns the row's value from the Topic's payload, or `null` or `undefined`
   * when the payload does not carry it, which draws the row's null placeholder.
   * The argument is typed as `topic`'s payload.
   */
  select: (
    payload: TopicPayloadMap[Topic],
  ) => SettingValueByType[SettingKind] | null | undefined;
  readOnly?: true;
}

/**
 * A stream-backed row as the settings registry holds it once registered: the
 * same fields as {@link StreamBackedSettingOf}, with `topic` a plain string
 * and `select` taking a payload of unknown type, since the registry holds rows
 * for every Topic at once. Write rows with {@link StreamBackedSettingOf}; this
 * is what reading them back gives.
 *
 * @category Settings
 */
export interface StoredStreamBackedSettingOf<SettingKind extends SettingType>
  extends SettingDefinitionBase {
  backing: "stream-backed";
  type?: SettingKind;
  topic: string;
  select: (
    payload: unknown,
  ) => SettingValueByType[SettingKind] | null | undefined;
  readOnly?: true;
}

/**
 * One row, of one {@link SettingType}: what {@link registerSetting} takes. The
 * type is inferred from `type`, so `defaultValue` and `select` must agree with
 * it.
 *
 * Reading the rows back gives a {@link SettingDefinition}, which covers every
 * type.
 *
 * @category Settings
 */
export type SettingDefinitionOf<
  SettingKind extends SettingType,
  Topic extends TopicId = TopicId,
> =
  | ClientPrefSettingOf<SettingKind>
  | StreamBackedSettingOf<SettingKind, Topic>;

/**
 * A setting stored in this browser, of any value type.
 *
 * @category Settings
 */
export type ClientPrefSetting =
  | ClientPrefSettingOf<"boolean">
  | ClientPrefSettingOf<"text">
  | ClientPrefSettingOf<"number">;

/**
 * A setting the mod owns, of any value type, read from a Topic. The row shows
 * its value and cannot change it.
 *
 * @category Settings
 */
export type StreamBackedSetting =
  | StoredStreamBackedSettingOf<"boolean">
  | StoredStreamBackedSettingOf<"text">
  | StoredStreamBackedSettingOf<"number">;

/**
 * Any registered row, whatever its backing and whatever its type.
 *
 * @category Settings
 */
export type SettingDefinition = ClientPrefSetting | StreamBackedSetting;

/**
 * Whether the operator can change this row: false when it is declared
 * `readOnly`, and false for a setting read from a Topic, which has no way to
 * write it.
 *
 * @category Settings
 */
export function isReadOnlySetting(def: SettingDefinition): boolean {
  if (def.backing === "stream-backed") return true;
  return def.readOnly === true;
}

/**
 * The declared type of a row, with the boolean default applied.
 *
 * @category Settings
 */
export function settingTypeOf(def: SettingDefinition): SettingType {
  return def.type ?? "boolean";
}

const registry = new Map<string, SettingDefinition>();

/**
 * The authoring overload: `SettingKind` is pinned by `type` (absent means `"boolean"`),
 * which is what makes `defaultValue` and `select` agree with each other and
 * with the row's declared type.
 */
export function registerSetting<
  SettingKind extends SettingType = "boolean",
  Topic extends TopicId = TopicId,
>(def: SettingDefinitionOf<SettingKind, Topic>): void;
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
