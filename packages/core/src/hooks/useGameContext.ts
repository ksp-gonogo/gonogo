import { type SpaceCenterState, useStream } from "@ksp-gonogo/sitrep-client";
import { useTelemetry } from "./useTelemetry";

export type GameScene =
  | "Flight"
  | "SpaceCenter"
  | "Editor"
  | "TrackingStation"
  | "MainMenu"
  | "Other"
  | "Unknown";

export type CareerMode = "CAREER" | "SCIENCE" | "SANDBOX" | "Unknown";

export interface GameContext {
  /**
   * Coarse scene id surfaced by the GonogoTelemetry plugin's `kc.scene`.
   * `"Unknown"` when telemetry hasn't arrived yet (vs `"Other"` which
   * means KSP is in a scene we don't enumerate, e.g. mid-load).
   */
  scene: GameScene;
  /** Convenience derived from `scene === "Flight"`. */
  inFlight: boolean;
  /**
   * True when the active vessel is in `PRELAUNCH` situation. Implies
   * `inFlight` (KSP only sets PRELAUNCH after the flight scene loads).
   */
  padOccupied: boolean;
  /**
   * `career.mode` from Telemachus. `"Unknown"` when the value hasn't
   * arrived yet. Sandbox saves are a meaningful state to detect
   * (gate career-only widgets) — don't lump it in with Unknown.
   */
  careerMode: CareerMode;
  /** True when careerMode is `"CAREER"` or `"SCIENCE"` — i.e. funds and/or science meaningful. */
  isCareerLike: boolean;
  /**
   * True when we have telemetry but no live game context (no flight,
   * no save). Used by widgets to decide whether to dim — distinguishes
   * "data sources connected but nothing happening" from "data sources
   * still booting up".
   */
  hasGameSignal: boolean;
}

const KNOWN_SCENES: ReadonlySet<GameScene> = new Set<GameScene>([
  "Flight",
  "SpaceCenter",
  "Editor",
  "TrackingStation",
  "MainMenu",
  "Other",
]);

const KNOWN_MODES: ReadonlySet<CareerMode> = new Set<CareerMode>([
  "CAREER",
  "SCIENCE",
  "SANDBOX",
]);

/**
 * `Sitrep.Contract.GameMode`'s enum declaration order (`contract.ts`:
 * Sandbox 0 / Career 1 / Science 2 / Unknown 3) — index-matched so the
 * mapped `career.mode.mode` ordinal resolves via a plain array lookup.
 */
const GAME_MODE_ORDINAL: readonly CareerMode[] = [
  "SANDBOX",
  "CAREER",
  "SCIENCE",
  "Unknown",
];

/**
 * `career.mode` (P4a D1) reads through two possible shapes depending on
 * whether the read routed to the stream or the legacy `DataSource`:
 *  - **legacy** (GonogoTelemetry's `career.mode` Telemachus key): a plain
 *    string (`"CAREER"`/`"SCIENCE"`/`"SANDBOX"`, any casing).
 *  - **stream** (mapped to `career.mode.mode` — see `map-topic.ts`): the
 *    mod's `GameMode` enum ORDINAL (a number), since `CareerMode.mode` is
 *    serialized as `(int)mode` on the wire, not the enum name.
 * Both resolve to the same `CareerMode` display string here so callers never
 * need to know which source answered.
 */
function resolveCareerMode(raw: unknown): CareerMode {
  if (typeof raw === "number") {
    return GAME_MODE_ORDINAL[raw] ?? "Unknown";
  }
  if (
    typeof raw === "string" &&
    KNOWN_MODES.has(raw.toUpperCase() as CareerMode)
  ) {
    return raw.toUpperCase() as CareerMode;
  }
  return "Unknown";
}

/**
 * Bundled subscription to KSP context telemetry. Widgets read this
 * single hook to decide whether their own data is "live" — most flight
 * widgets dim themselves outside `Flight`, career-only widgets dim
 * outside `isCareerLike`, etc.
 *
 * Three subscriptions, one render. Cheap to call from many widgets at
 * once because `useDataValue` already deduplicates per-key.
 */
export function useGameContext(): GameContext {
  // Canonical Topic reads (former Telemachus kc.*/career.* keys resolved
  // through map-topic.ts): kc.scene -> spaceCenter.scene.scene and
  // career.mode -> career.mode.mode (the numeric GameMode ordinal
  // resolveCareerMode below maps to a display string), both plain one-arg
  // Topic reads; kc.padOccupied -> the DERIVED spaceCenter.state channel
  // (space-center-state.ts, off spaceCenter.launchSites), read via useStream.
  const sceneRaw = useTelemetry("spaceCenter.scene")?.scene;
  const padOccupiedRaw =
    useStream<SpaceCenterState>("spaceCenter.state")?.padOccupied;
  const careerModeRaw = useTelemetry("career.mode")?.mode;

  const scene: GameScene =
    typeof sceneRaw === "string" && KNOWN_SCENES.has(sceneRaw as GameScene)
      ? (sceneRaw as GameScene)
      : "Unknown";

  const careerMode: CareerMode = resolveCareerMode(careerModeRaw);

  const inFlight = scene === "Flight";
  const padOccupied = padOccupiedRaw === true;
  const isCareerLike = careerMode === "CAREER" || careerMode === "SCIENCE";
  const hasGameSignal = scene !== "Unknown" || careerMode !== "Unknown";

  return {
    scene,
    inFlight,
    padOccupied,
    careerMode,
    isCareerLike,
    hasGameSignal,
  };
}
