import type {
  SettingDefinition,
  SettingDefinitionOf,
  SettingType,
  TopicId,
} from "@ksp-gonogo/sitrep-sdk";
import {
  registerSetting,
  type SitrepUnit,
  value,
} from "@ksp-gonogo/sitrep-sdk";

/**
 * A planted Uplink's settings rows, standing in for a real Uplink's so the
 * settings render has read-only rows to show that no Uplink of this repo owns.
 *
 * Shaped to carry each thing the render exists to judge: stream-backed rows
 * with no writer, text and number types, quantities beside bare counts, a
 * boolean, and several named groups inside one category. Every row selects
 * off {@link PLANTED_SETTINGS_TOPIC}, so a scene that emits nothing shows every
 * placeholder at once.
 *
 * Side-effect module, imported dynamically by the probe after the host is
 * installed: `registerSetting` resolves through that host.
 */
export const PLANTED_SETTINGS_TOPIC = "planted.settings" as const;

const CATEGORY = "Planted Uplink";

const GROUP = {
  frame: "Frame",
  prediction: "Prediction",
  history: "History",
  diagnostics: "Diagnostics",
} as const;

/** The payload the scenes emit. */
interface PlantedSettings {
  status?: string;
  build?: string;
  frameName?: string;
  frameCentre?: string;
  frameHasApsides?: boolean;
  toleranceMetres?: number;
  maxSteps?: number;
  windowSeconds?: number;
  historySeconds?: number;
  markersHidden?: number;
  logThreshold?: string;
  journaling?: boolean;
}

declare module "@ksp-gonogo/sitrep-sdk" {
  interface TopicPayloadMap {
    /** `undefined` while the Topic is silent, which a scene uses to show every placeholder. */
    "planted.settings": PlantedSettings | undefined;
  }
}

/**
 * A bare number off the wire as a `Value` in `unit`. The quantities arrive as
 * the mod sends them, unwrapped, because no unit table covers a planted Topic,
 * so each row names its own unit.
 */
function asValue(unit: SitrepUnit, magnitude: number | undefined) {
  return magnitude === undefined ? undefined : value(unit, magnitude);
}

const row = <
  T extends SettingType = "boolean",
  Topic extends TopicId = TopicId,
>(
  def: SettingDefinitionOf<T, Topic>,
): SettingDefinition => def as SettingDefinition;

const ROWS: readonly SettingDefinition[] = [
  row({
    id: "planted.settings.status",
    backing: "stream-backed",
    type: "text",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => p?.status,
    category: CATEGORY,
    label: "Status",
    description: "Whether the planted Uplink is reporting at all.",
    screens: ["main"],
  }),
  row({
    id: "planted.settings.build",
    backing: "stream-backed",
    type: "text",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => p?.build,
    category: CATEGORY,
    label: "Build",
    screens: ["main"],
  }),
  row({
    id: "planted.settings.frameName",
    backing: "stream-backed",
    type: "text",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => p?.frameName,
    category: CATEGORY,
    group: GROUP.frame,
    label: "Frame",
    description: "The frame the planted Uplink quotes its numbers in.",
    screens: ["main"],
  }),
  row({
    id: "planted.settings.frameCentre",
    backing: "stream-backed",
    type: "text",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => p?.frameCentre,
    category: CATEGORY,
    group: GROUP.frame,
    label: "Centre body",
    screens: ["main"],
  }),
  row({
    id: "planted.settings.frameHasApsides",
    backing: "stream-backed",
    type: "boolean",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => p?.frameHasApsides,
    category: CATEGORY,
    group: GROUP.frame,
    label: "Apsides exist in this frame",
    screens: ["main"],
  }),
  row({
    id: "planted.settings.tolerance",
    backing: "stream-backed",
    type: "number",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => asValue("m", p?.toleranceMetres),
    category: CATEGORY,
    group: GROUP.prediction,
    label: "Prediction tolerance",
    description: "A length, drawn with its unit.",
    screens: ["main"],
  }),
  row({
    id: "planted.settings.maxSteps",
    backing: "stream-backed",
    type: "number",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => asValue("count", p?.maxSteps),
    category: CATEGORY,
    group: GROUP.prediction,
    label: "Prediction step limit",
    description: "A bare count beside the length above.",
    screens: ["main"],
  }),
  row({
    id: "planted.settings.window",
    backing: "stream-backed",
    type: "number",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => asValue("s", p?.windowSeconds),
    category: CATEGORY,
    group: GROUP.prediction,
    label: "Analysis window",
    screens: ["main"],
  }),
  row({
    id: "planted.settings.history",
    backing: "stream-backed",
    type: "number",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => asValue("s", p?.historySeconds),
    category: CATEGORY,
    group: GROUP.history,
    label: "History length",
    screens: ["main"],
  }),
  row({
    id: "planted.settings.markersHidden",
    backing: "stream-backed",
    type: "number",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => asValue("count", p?.markersHidden),
    category: CATEGORY,
    group: GROUP.history,
    label: "Frames hiding markers",
    screens: ["main"],
  }),
  row({
    id: "planted.settings.logThreshold",
    backing: "stream-backed",
    type: "text",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => p?.logThreshold,
    category: CATEGORY,
    group: GROUP.diagnostics,
    label: "Log threshold",
    description: "A severity by name rather than by ordinal.",
    screens: ["main"],
  }),
  row({
    id: "planted.settings.journaling",
    backing: "stream-backed",
    type: "boolean",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => p?.journaling,
    category: CATEGORY,
    group: GROUP.diagnostics,
    label: "Journal recording now",
    screens: ["main"],
  }),
];

/** The `dependsOn` parent the render switches on and off. */
export const PLANTED_PARENT_SETTING = "planted.settings.parent";

/**
 * A writable parent and two children that depend on it, for the `dependsOn`
 * render: the children go inert while the parent is off.
 */
const DEPENDENT_ROWS: readonly SettingDefinition[] = [
  row({
    id: PLANTED_PARENT_SETTING,
    type: "boolean",
    category: "Planted Dependency",
    label: "Record",
    description: "The parent both rows below depend on.",
    defaultValue: true,
    screens: ["main"],
  }),
  row({
    id: "planted.settings.childAll",
    type: "boolean",
    category: "Planted Dependency",
    label: "Record everything",
    description: "Has no effect while Record is off.",
    defaultValue: false,
    screens: ["main"],
    dependsOn: PLANTED_PARENT_SETTING,
  }),
  row({
    id: "planted.settings.childVideo",
    type: "boolean",
    category: "Planted Dependency",
    label: "Record video",
    defaultValue: false,
    screens: ["main"],
    dependsOn: PLANTED_PARENT_SETTING,
  }),
];

for (const def of [...DEPENDENT_ROWS, ...ROWS]) registerSetting(def);
