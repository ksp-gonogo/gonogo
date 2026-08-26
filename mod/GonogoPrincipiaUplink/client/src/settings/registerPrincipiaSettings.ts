import type {
  SettingDefinition,
  SettingDefinitionOf,
  SettingType,
} from "@ksp-gonogo/sitrep-sdk";
import { registerSetting } from "@ksp-gonogo/sitrep-sdk";
import type {
  PrincipiaReferenceFrame,
  PrincipiaSettings,
} from "../__generated__/contract";
import {
  frameHasApsides,
  frameLengthsPulsate,
  plottingFrameKindLabel,
  plottingFrameLabel,
} from "../plottingFrame";

/*
 * Principia's session configuration, as settings rows.
 *
 * Every row here is `stream-backed` and therefore read-only: the values arrive
 * on `principia.settings`, a `DelayRole.TrueNow` Topic, and the console has no
 * writer for any of them. That is not a limitation being worked around, it is
 * what these rows ARE. A plotting frame, an integration tolerance and a step
 * limit decide what every other number on the board means, and an operator who
 * cannot see them is reading numbers whose basis is hidden.
 *
 * Two of the values are stronger than a settings row usually is. The per-vessel
 * prediction bounds and the per-plan integrator bounds are read from the
 * producer's own plugin rather than off its sliders, so they are what that
 * vessel's prediction ACTUALLY used, not what a control was last set to.
 *
 * Rows this payload carries and this file deliberately does NOT register:
 * target vessel and target celestial belong on `target-picker`, the per-frame
 * declutter flags and the pin exemption list belong on `map-view.sections`, the
 * navball guidance toggle belongs on `navball`, and the four per-plan settings
 * travel with the plan into `maneuver-planner`. A setting is a qualifier on
 * some other readout, so it goes where that readout is; what is left here is
 * what qualifies the session rather than one widget.
 *
 * Side-effect module: importing it runs every registration once, the same
 * lifecycle as this package's other module-load registrations.
 */

const CATEGORY = "Principia";

const GROUP = {
  frame: "Plotting frame",
  ksp: "KSP features",
  prediction: "Prediction",
  analysis: "Analysis",
  drawing: "Drawing",
  diagnostics: "Diagnostics",
} as const;

/**
 * The payload, or `undefined` while the Topic has said nothing.
 *
 * Every `select` below goes through this rather than casting inline, so a row
 * whose field is missing and a row on a silent Topic reach the renderer as the
 * same `undefined`. Both mean "the mod has not said", and both must render as
 * the null placeholder rather than as a zero or an empty string.
 */
function settings(payload: unknown): PrincipiaSettings | undefined {
  return (payload ?? undefined) as PrincipiaSettings | undefined;
}

function frame(payload: unknown): PrincipiaReferenceFrame | undefined {
  return settings(payload)?.plottingFrame;
}

/**
 * A list of body names as one line, or `undefined` for an absent OR empty list.
 *
 * An empty list is rendered as absence deliberately: "no bodies" and "the mod
 * did not say which bodies" are indistinguishable from outside this payload,
 * and an empty string reads as a value that happens to be blank.
 */
function bodyList(names: string[] | undefined): string | undefined {
  if (names === undefined || names.length === 0) return undefined;
  return names.join(", ");
}

/**
 * The producer's log severities, by the glog ordinal it carries them on.
 *
 * Named rather than shown as an integer because the number is meaningless on
 * sight and its ordering is the whole point: a threshold of 2 means errors and
 * fatals reach that sink and nothing else does. An ordinal outside the table
 * reads as itself, the same unknown-ordinal posture `plottingFrameLabel` takes.
 */
const SEVERITY_NAMES: Readonly<Record<number, string>> = {
  0: "INFO",
  1: "WARNING",
  2: "ERROR",
  3: "FATAL",
};

function severityName(ordinal: number | undefined): string | undefined {
  if (ordinal === undefined) return undefined;
  return SEVERITY_NAMES[ordinal] ?? `Severity ${ordinal}`;
}

/**
 * A `Value<"count">` arrives wrapped, and a threshold is an ordinal rather than
 * a quantity, so it has to be unwrapped before it can be named.
 */
function countOf(v: { magnitude: number } | undefined): number | undefined {
  return v === undefined ? undefined : v.magnitude;
}

/**
 * One row, typed at its own {@link SettingType} and handed back as the union.
 *
 * The rows are a LIST rather than thirty-seven bare `registerSetting` calls so
 * that a test can put a payload through a `select` without standing up the
 * app's settings surface, which an Uplink may not import. The generic is what
 * `registerSetting` itself has: declaring `type: "number"` and then selecting a
 * string is a compile error here, at the row, rather than a `Switch` rendering
 * a tolerance at runtime.
 */
const row = <T extends SettingType = "boolean">(
  def: SettingDefinitionOf<T>,
): SettingDefinition => def as SettingDefinition;

/** Every row this Uplink files under the Principia category, in render order. */
export const PRINCIPIA_SETTINGS: readonly SettingDefinition[] = [
  // ---- The session itself ----

  row({
    id: "principia.settings.health",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => {
      const s = settings(p);
      if (s === undefined) return undefined;
      if (s.readingSuspended === true) return "Reading suspended";
      if (s.pluginVersion === undefined) return "No session bound";
      return "Reading";
    },
    category: CATEGORY,
    label: "Principia",
    description:
      "Whether this Uplink is reading the plugin at all. Every row below goes quiet together when it is not, so this is the row that answers why.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.suspendedReason",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => settings(p)?.readingSuspendedReason,
    category: CATEGORY,
    label: "Why reading stopped",
    description:
      "Present only while reading is suspended. The commonest cause is the plugin recording a journal, which our polling would write itself into.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.build",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => settings(p)?.pluginVersion,
    category: CATEGORY,
    label: "Build",
    description:
      "The plugin build string as the session's version gate read it. What the gate compares against when it closes.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.observedAt",
    backing: "stream-backed",
    type: "number",
    topic: "principia.settings",
    select: (p) => settings(p)?.observedAtUt,
    category: CATEGORY,
    label: "Read at",
    description: "When these settings were last read from the plugin.",
    screens: ["main"],
  }),

  // ---- Plotting frame ----

  row({
    id: "principia.settings.frame",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => {
      const f = frame(p);
      if (f === undefined) return undefined;
      return plottingFrameLabel(f.type, {
        centre: f.centreBody,
        primary: f.primaryBody,
        secondary: f.secondaryBody,
      });
    },
    category: CATEGORY,
    group: GROUP.frame,
    label: "Frame",
    description:
      "The frame every trajectory, node and apsis on this board is expressed in. The same vessel reads as a different orbit in a different frame.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.frameKind",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => {
      const f = frame(p);
      return f === undefined ? undefined : plottingFrameKindLabel(f.type);
    },
    category: CATEGORY,
    group: GROUP.frame,
    label: "Frame kind",
    description: "Which sort of frame that is, undeclined by its bodies.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.frameSelector",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => frame(p)?.selector,
    category: CATEGORY,
    group: GROUP.frame,
    label: "Selector",
    description:
      "The plugin's own name for the selector instance this frame came from.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.frameCentre",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => frame(p)?.centreBody,
    category: CATEGORY,
    group: GROUP.frame,
    label: "Centre body",
    description:
      "Absent in the frames that have no centre, which is also why they have no apsides.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.framePrimary",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => frame(p)?.primaryBody,
    category: CATEGORY,
    group: GROUP.frame,
    label: "Primary body",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.frameSecondary",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => frame(p)?.secondaryBody,
    category: CATEGORY,
    group: GROUP.frame,
    label: "Secondary body",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.framePrimaries",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => bodyList(frame(p)?.primaryBodies),
    category: CATEGORY,
    group: GROUP.frame,
    label: "Primary bodies",
    description:
      "A rotating-pulsating frame is anchored to a whole set rather than to one body.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.frameSecondaries",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => bodyList(frame(p)?.secondaryBodies),
    category: CATEGORY,
    group: GROUP.frame,
    label: "Secondary bodies",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.frameTargetSelected",
    backing: "stream-backed",
    type: "boolean",
    topic: "principia.settings",
    select: (p) => frame(p)?.targetFrameSelected,
    category: CATEGORY,
    group: GROUP.frame,
    label: "Target frame selected",
    description:
      "The target frame overrides the choice above, and clearing the target silently changes the frame back.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.frameTargetVessel",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => frame(p)?.targetVesselName,
    category: CATEGORY,
    group: GROUP.frame,
    label: "Frame target vessel",
    description: "Which vessel the target frame is anchored to.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.frameHasApsides",
    backing: "stream-backed",
    type: "boolean",
    topic: "principia.settings",
    select: (p) => {
      const f = frame(p);
      return f === undefined
        ? undefined
        : frameHasApsides(f.type, f.targetFrameSelected);
    },
    category: CATEGORY,
    group: GROUP.frame,
    label: "Apsides exist in this frame",
    description:
      "Off means an apsis here is undefined rather than unmeasured, which is a different thing to tell an operator hunting a missing marker.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.frameLengthsPulsate",
    backing: "stream-backed",
    type: "boolean",
    topic: "principia.settings",
    select: (p) => {
      const f = frame(p);
      return f === undefined ? undefined : frameLengthsPulsate(f.type);
    },
    category: CATEGORY,
    group: GROUP.frame,
    label: "Lengths pulsate in this frame",
    description:
      "On means the frame's length unit varies with time, so an absolute distance quoted in it is not a distance.",
    screens: ["main"],
  }),

  // ---- KSP features ----

  row({
    id: "principia.settings.patchedConics",
    backing: "stream-backed",
    type: "boolean",
    topic: "principia.settings",
    select: (p) => settings(p)?.displayPatchedConics,
    category: CATEGORY,
    group: GROUP.ksp,
    label: "Stock patched conics also drawn",
    description:
      "On means the game is drawing two contradictory futures at once. The plugin's own label for this setting ends: do not use for flight planning.",
    screens: ["main"],
  }),

  // ---- Prediction ----

  row({
    id: "principia.settings.predictionVessel",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => settings(p)?.predictionVesselId,
    category: CATEGORY,
    group: GROUP.prediction,
    label: "Prediction read for",
    description:
      "The two bounds below are per-vessel, so without this they would read as global and mislead about every other craft.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.predictionTolerance",
    backing: "stream-backed",
    type: "number",
    topic: "principia.settings",
    select: (p) => settings(p)?.predictionToleranceMetres,
    category: CATEGORY,
    group: GROUP.prediction,
    label: "Prediction tolerance",
    description:
      "Read from that vessel's own integrator parameters, so it is what the prediction actually held to rather than what the slider says.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.predictionMaxSteps",
    backing: "stream-backed",
    type: "number",
    topic: "principia.settings",
    select: (p) => settings(p)?.predictionMaxSteps,
    category: CATEGORY,
    group: GROUP.prediction,
    label: "Prediction step limit",
    description:
      "A prediction that stopped short looks exactly like a trajectory that ended, and this is the only number separating them.",
    screens: ["main"],
  }),

  // ---- Analysis ----

  row({
    id: "principia.settings.analysisWindow",
    backing: "stream-backed",
    type: "number",
    topic: "principia.settings",
    select: (p) => settings(p)?.analysisMissionDurationRequestedSeconds,
    category: CATEGORY,
    group: GROUP.analysis,
    label: "Analysis window requested",
    description:
      "The window the in-game analyser was asked for. Widening it widens every interval it reports and can flip every adjective.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.recurrenceAutodetect",
    backing: "stream-backed",
    type: "boolean",
    topic: "principia.settings",
    select: (p) => settings(p)?.recurrenceAutodetect,
    category: CATEGORY,
    group: GROUP.analysis,
    label: "Recurrence autodetected",
    description:
      "Off means the two rows below are the cycle the plugin was told to use in game.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.recurrenceRevolutions",
    backing: "stream-backed",
    type: "number",
    topic: "principia.settings",
    select: (p) => settings(p)?.recurrenceRevolutionsPerCycle,
    category: CATEGORY,
    group: GROUP.analysis,
    label: "Recurrence revolutions per cycle",
    description:
      "Inert for our own figures, and here for exactly that reason: it explains a disagreement between the player's screen and this one.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.recurrenceDays",
    backing: "stream-backed",
    type: "number",
    topic: "principia.settings",
    select: (p) => settings(p)?.recurrenceDaysPerCycle,
    category: CATEGORY,
    group: GROUP.analysis,
    label: "Recurrence days per cycle",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.groundTrackRevolution",
    backing: "stream-backed",
    type: "number",
    topic: "principia.settings",
    select: (p) => settings(p)?.groundTrackRevolution,
    category: CATEGORY,
    group: GROUP.analysis,
    label: "Ground-track revolution",
    description:
      "Which revolution the in-game equatorial-crossing longitudes are quoted for. Both change meaning with it, from a stepper off this screen.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.stabilityGridMaxEMinI",
    backing: "stream-backed",
    type: "boolean",
    topic: "principia.settings",
    select: (p) => settings(p)?.stabilityGridMaxEccentricityMinInclination,
    category: CATEGORY,
    group: GROUP.analysis,
    label: "Stability grid: max e, min i",
    description:
      "Which contour family the in-game stability graph is read against. The same curve against the wrong family reads as the opposite conclusion.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.stabilityGridMinEMaxI",
    backing: "stream-backed",
    type: "boolean",
    topic: "principia.settings",
    select: (p) => settings(p)?.stabilityGridMinEccentricityMaxInclination,
    category: CATEGORY,
    group: GROUP.analysis,
    label: "Stability grid: min e, max i",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.showElementGraphs",
    backing: "stream-backed",
    type: "boolean",
    topic: "principia.settings",
    select: (p) => settings(p)?.showElementGraphs,
    category: CATEGORY,
    group: GROUP.analysis,
    label: "Element graphs shown in game",
    description:
      "A view toggle in game. Our graphs are a widget instead, so this is what explains this board having history the player's does not.",
    screens: ["main"],
  }),

  // ---- Drawing ----

  row({
    id: "principia.settings.historyLength",
    backing: "stream-backed",
    type: "number",
    topic: "principia.settings",
    select: (p) => settings(p)?.historyLengthSeconds,
    category: CATEGORY,
    group: GROUP.drawing,
    label: "History length drawn in game",
    description:
      "How much flown history the plugin draws, for the vessel and for every celestial. Our map keeps its own, so this exists to explain a disagreement between screens.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.framesHidingMarkers",
    backing: "stream-backed",
    type: "number",
    topic: "principia.settings",
    select: (p) => settings(p)?.framesHidingUnpinnedMarkers,
    category: CATEGORY,
    group: GROUP.drawing,
    label: "Frames hiding unpinned markers",
    description:
      "Decluttering is per frame, and the map says whether this frame hides them. The total is here so that answer reads as one case of a habit.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.framesHidingCelestials",
    backing: "stream-backed",
    type: "number",
    topic: "principia.settings",
    select: (p) => settings(p)?.framesHidingUnpinnedCelestials,
    category: CATEGORY,
    group: GROUP.drawing,
    label: "Frames hiding unpinned celestials",
    screens: ["main"],
  }),

  // ---- Diagnostics ----

  row({
    id: "principia.settings.verboseLevel",
    backing: "stream-backed",
    type: "number",
    topic: "principia.settings",
    select: (p) => settings(p)?.verboseLevel,
    category: CATEGORY,
    group: GROUP.diagnostics,
    label: "Verbose level",
    description: "How much the plugin is writing, 0 to 4.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.logThreshold",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => severityName(countOf(settings(p)?.logThreshold)),
    category: CATEGORY,
    group: GROUP.diagnostics,
    label: "Log file threshold",
    description:
      "The severity at or above which a message reaches the log file.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.stderrThreshold",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => severityName(countOf(settings(p)?.stderrThreshold)),
    category: CATEGORY,
    group: GROUP.diagnostics,
    label: "Standard-error threshold",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.flushThreshold",
    backing: "stream-backed",
    type: "text",
    topic: "principia.settings",
    select: (p) => severityName(countOf(settings(p)?.flushThreshold)),
    category: CATEGORY,
    group: GROUP.diagnostics,
    label: "Flush threshold",
    description:
      "The severity above which the log is flushed rather than buffered.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.recordJournalRequested",
    backing: "stream-backed",
    type: "boolean",
    topic: "principia.settings",
    select: (p) => settings(p)?.recordJournalRequested,
    category: CATEGORY,
    group: GROUP.diagnostics,
    label: "Journal recording requested",
    description:
      "Takes effect on the next load, so it is deliberately not the same fact as the row below.",
    screens: ["main"],
  }),

  row({
    id: "principia.settings.journaling",
    backing: "stream-backed",
    type: "boolean",
    topic: "principia.settings",
    select: (p) => settings(p)?.journaling,
    category: CATEGORY,
    group: GROUP.diagnostics,
    label: "Journal recording now",
    description:
      "On means a recorder is actually running, and we stop reading the plugin. Its journal records every call made through the plugin interface, ours included, and that journal is the artefact a bug report is made of.",
    screens: ["main"],
  }),
];

for (const def of PRINCIPIA_SETTINGS) registerSetting(def);
