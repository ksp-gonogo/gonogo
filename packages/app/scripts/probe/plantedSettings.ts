import type {
  SettingDefinition,
  SettingDefinitionOf,
  SettingType,
} from "@ksp-gonogo/sitrep-sdk";
import { registerSetting, value } from "@ksp-gonogo/sitrep-sdk";

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
export const PLANTED_SETTINGS_TOPIC = "planted.settings";

const CATEGORY = "Planted Uplink";

const GROUP = {
  frame: "Frame",
  prediction: "Prediction",
  history: "History",
  diagnostics: "Diagnostics",
} as const;

/** The payload the scenes emit, or `undefined` while the Topic is silent. */
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

function settings(payload: unknown): PlantedSettings | undefined {
  return (payload ?? undefined) as PlantedSettings | undefined;
}

/**
 * Wrap a bare magnitude off the wire in its unit, the way the SDK does for a
 * real Uplink. Absence passes straight through so a silent Topic still shows
 * its placeholder.
 */
function quantity<U extends string>(unit: U, magnitude: number | undefined) {
  return magnitude === undefined ? undefined : value(unit, magnitude);
}

const row = <T extends SettingType = "boolean">(
  def: SettingDefinitionOf<T>,
): SettingDefinition => def as SettingDefinition;

const ROWS: readonly SettingDefinition[] = [
  row({
    id: "planted.settings.status",
    backing: "stream-backed",
    type: "text",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => settings(p)?.status,
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
    select: (p) => settings(p)?.build,
    category: CATEGORY,
    label: "Build",
    screens: ["main"],
  }),
  row({
    id: "planted.settings.frameName",
    backing: "stream-backed",
    type: "text",
    topic: PLANTED_SETTINGS_TOPIC,
    select: (p) => settings(p)?.frameName,
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
    select: (p) => settings(p)?.frameCentre,
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
    select: (p) => settings(p)?.frameHasApsides,
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
    select: (p) => quantity("m", settings(p)?.toleranceMetres),
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
    select: (p) => quantity("count", settings(p)?.maxSteps),
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
    select: (p) => quantity("s", settings(p)?.windowSeconds),
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
    select: (p) => quantity("s", settings(p)?.historySeconds),
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
    select: (p) => quantity("count", settings(p)?.markersHidden),
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
    select: (p) => settings(p)?.logThreshold,
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
    select: (p) => settings(p)?.journaling,
    category: CATEGORY,
    group: GROUP.diagnostics,
    label: "Journal recording now",
    screens: ["main"],
  }),
];

for (const def of ROWS) registerSetting(def);
