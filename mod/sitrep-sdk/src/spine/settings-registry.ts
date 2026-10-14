import { SettingKind } from "../__generated__/contract";
import type { TopicId, TopicPayloadMap } from "../topics";
import type { Value } from "../unit-system";
import type { Screen } from "./screen";

/**
 * Global registry of user-facing settings. Mirrors the `registerComponent`
 * pattern: features (and Uplinks, via the sitrep-sdk facade) co-locate their
 * own setting definition with the code that consumes it, and `SettingsModal`
 * renders whatever's registered, generically, with no per-mod knowledge.
 *
 * This is the preferred way an Uplink surfaces settings: declare a row here and
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
 *     writer at all. This is what a setting looks like when it is provenance
 *     rather than preference: a plugin's own configuration, read off the wire,
 *     which the operator needs in order to know what every other number means.
 *
 * **Type**: a {@link SettingKind}, `Bool`, `Text` or `Number`: the same one the
 * mod's own settings rows and `AugmentSettingField` use. A `Number` row may
 * hand back a `Value` instead of a bare number, and then it renders through
 * `Unit` and announces its unit as a word.
 *
 * **Writability**: `readOnly` renders the value instead of a control. A row
 * whose underlying `Set*` is refused, or which has no writer at all, must
 * declare it: a control offering to change something that cannot change is a
 * lie, and the operator finds out only by trying.
 *
 * **Grouping** is orthogonal to all three. `category` is the heading a row
 * files under; `group` is a named block inside that category, so a mod with
 * forty rows reads as five short lists rather than one wall.
 */

/**
 * The value each {@link SettingKind} carries. A {@link SettingKind.Number} row
 * may hold a `Value`, such as `value("m", 1)`, so it is drawn with its unit.
 * Useful for showing the operator a setting in the control that suits its kind:
 * a switch, a line of text or a number.
 *
 * @category Settings
 */
export interface SettingValueByType {
  /** A switch. */
  [SettingKind.Bool]: boolean;
  /** A line of text. */
  [SettingKind.Text]: string;
  /** A number, bare or as a `Value` with its unit. */
  [SettingKind.Number]: number | Value;
}

/**
 * Any value a registered row can carry. Useful for showing the operator a
 * setting's current value whatever its kind. Used by {@link SettingsService}.
 *
 * @category Settings
 */
export type SettingValue = SettingValueByType[SettingKind];

/**
 * What every registered settings row carries, whatever its backing and type.
 * Useful for giving every row of the settings panel the same label, description
 * and place.
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
   * the row, and disables it while the parent is `false`.
   * That is all it does: {@link useSetting} still returns the row's own
   * value, so code that should obey the parent reads both and combines them.
   */
  dependsOn?: string;
}

/**
 * A setting saved in this browser's `localStorage`, under its `id`. This is the
 * default: `backing` may be left out, and so may `type`, which then means
 * {@link SettingKind.Bool}. Useful for declaring a setting the operator changes
 * and the browser remembers.
 *
 * @category Settings
 */
export interface ClientPrefSettingOf<ValueType extends SettingKind>
  extends SettingDefinitionBase {
  /** Where the value is kept: `"client-pref"`, this browser. The default, so it may be left out. */
  backing?: "client-pref";
  /** The kind of value: {@link SettingKind.Bool} (the default when left out), {@link SettingKind.Text} or {@link SettingKind.Number}. Sets the control drawn. */
  type?: ValueType;
  /** The value the row holds until the operator changes it. */
  defaultValue: SettingValueByType[ValueType];
}

/**
 * A setting whose value arrives on a Topic, which the row only shows: a mod's
 * own configuration, as its Uplink publishes it.
 *
 * It cannot be changed from the row whatever its `readOnly` says, so ask {@link
 * isReadOnlySetting} whether a row can be changed rather than reading the flag.
 * Useful for showing the operator how the mod is configured, in the settings
 * panel.
 *
 * @category Settings
 */
export interface StreamBackedSettingOf<
  ValueType extends SettingKind,
  Topic extends TopicId = TopicId,
> extends SettingDefinitionBase {
  /** Where the value comes from: `"stream-backed"`, a Topic. */
  backing: "stream-backed";
  /** The kind of value: {@link SettingKind.Bool} (the default when left out), {@link SettingKind.Text} or {@link SettingKind.Number}. Sets how the value is drawn. */
  type?: ValueType;
  /** The Topic id whose payload carries this row's value. */
  topic: Topic;
  /**
   * Returns the row's value from the Topic's payload, or `null` or `undefined`
   * when the payload does not carry it, which draws the row's null placeholder.
   * The argument is typed as `topic`'s payload.
   */
  select: (
    payload: TopicPayloadMap[Topic],
  ) => SettingValueByType[ValueType] | null | undefined;
  readOnly?: true;
}

/**
 * A stream-backed row as the settings registry holds it once registered: the
 * same fields as {@link StreamBackedSettingOf}, with `topic` a plain string and
 * `select` taking a payload of unknown type, since the registry holds rows for
 * every Topic at once. Write rows with {@link StreamBackedSettingOf}; this is
 * what reading them back gives. Useful for listing, in the settings panel, the
 * rows whose value the mod reports.
 *
 * @category Settings
 */
export interface StoredStreamBackedSettingOf<ValueType extends SettingKind>
  extends SettingDefinitionBase {
  /** Always `"stream-backed"`: the value is read from a Topic rather than stored. */
  backing: "stream-backed";
  /** The kind of value the row holds. */
  type?: ValueType;
  /** The id of the Topic the value is read from. */
  topic: string;
  /** Picks the row's value out of the Topic's payload. */
  select: (
    payload: unknown,
  ) => SettingValueByType[ValueType] | null | undefined;
  readOnly?: true;
}

/**
 * One row, of one {@link SettingKind}: what {@link registerSetting} takes. The
 * type is inferred from `type`, so `defaultValue` and `select` must agree with
 * it.
 *
 * Reading the rows back gives a {@link SettingDefinition}, which covers every
 * type. Useful for declaring one row of the settings panel that the operator
 * sees.
 *
 * @category Settings
 */
export type SettingDefinitionOf<
  ValueType extends SettingKind,
  Topic extends TopicId = TopicId,
> = ClientPrefSettingOf<ValueType> | StreamBackedSettingOf<ValueType, Topic>;

/**
 * A setting stored in this browser, of any value type. Useful for listing, in
 * the settings panel, the settings that the operator's browser remembers. Used
 * by the app's settings panel.
 *
 * @category Settings
 */
export type ClientPrefSetting =
  | ClientPrefSettingOf<SettingKind.Bool>
  | ClientPrefSettingOf<SettingKind.Text>
  | ClientPrefSettingOf<SettingKind.Number>;

/**
 * A setting the mod owns, of any value type, read from a Topic. The row shows
 * its value and cannot change it. Useful for showing the operator a mod's own
 * configuration in the settings panel. Used by the app's settings rows.
 *
 * @category Settings
 */
export type StreamBackedSetting =
  | StoredStreamBackedSettingOf<SettingKind.Bool>
  | StoredStreamBackedSettingOf<SettingKind.Text>
  | StoredStreamBackedSettingOf<SettingKind.Number>;

/**
 * Any registered row, whatever its backing and whatever its type. Useful for
 * listing every row of the settings panel that the operator sees. Used by the
 * app's settings panel.
 *
 * @category Settings
 */
export type SettingDefinition = ClientPrefSetting | StreamBackedSetting;

/**
 * Whether the operator can change this row: false when it is declared
 * `readOnly`, and false for a setting read from a Topic, which has no way to
 * write it. Useful for drawing a row as a labelled value rather than a control
 * when the operator cannot change it. Used by the Settings window when it draws
 * each row.
 *
 * @category Settings
 */
export function isReadOnlySetting(def: SettingDefinition): boolean {
  if (def.backing === "stream-backed") return true;
  return def.readOnly === true;
}

/**
 * The declared kind of a row, with the {@link SettingKind.Bool} default applied.
 * Useful for choosing the control a row is drawn with. Used by the Settings
 * window when it draws each row.
 *
 * @category Settings
 */
export function settingKindOf(def: SettingDefinition): SettingKind {
  return def.type ?? SettingKind.Bool;
}

const registry = new Map<string, SettingDefinition>();

/**
 * Adds a settings row to the Settings window, for an Uplink or a feature of the
 * app. `type` pins the kind of value, with {@link SettingKind.Bool} when it is
 * left out, so `defaultValue` and `select` must agree with it. Registering an
 * `id` again replaces the earlier row. Useful for letting the operator view or
 * change a setting without a custom tab. Used by the app's own features, such as
 * the station wake lock, and by Uplink client packages.
 */
export function registerSetting<
  ValueType extends SettingKind = SettingKind.Bool,
  Topic extends TopicId = TopicId,
>(def: SettingDefinitionOf<ValueType, Topic>): void;
/**
 * Adds a row that is already typed as a {@link SettingDefinition}, for a host
 * that passes on a definition it did not author and so has no `type` literal to
 * check against.
 */
export function registerSetting(def: SettingDefinition): void;
export function registerSetting(def: SettingDefinition): void {
  // Registering an id again replaces the row, so hot module reload can re-run a registration module.
  registry.set(def.id, def);
}

/**
 * The registered settings row for `id`, or `undefined` when none is registered.
 * Useful for reading how a row is declared, such as its kind or whether it is
 * read-only. Used by the Settings window when it draws a row.
 */
export function getSettingDefinition(
  id: string,
): SettingDefinition | undefined {
  return registry.get(id);
}

/**
 * Every registered settings row, in registration order. Useful for listing the
 * operator's settings. Used by the Settings window.
 */
export function getAllSettings(): SettingDefinition[] {
  return [...registry.values()];
}

/**
 * The registered settings rows relevant on `screen`: those with no `screens`
 * list and those whose list includes it. Useful for showing the main screen and
 * a station only the settings that apply to them. Used by the Settings window.
 */
export function getSettingsForScreen(screen: Screen): SettingDefinition[] {
  return getAllSettings().filter(
    (s) => !s.screens || s.screens.includes(screen),
  );
}

/** Removes every registered settings row, so a test starts from an empty registry. */
export function __clearSettingsForTests(): void {
  registry.clear();
}
