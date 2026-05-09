import { useDataValue } from "./useDataValue";

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
 * Bundled subscription to KSP context telemetry. Widgets read this
 * single hook to decide whether their own data is "live" — most flight
 * widgets dim themselves outside `Flight`, career-only widgets dim
 * outside `isCareerLike`, etc.
 *
 * Three subscriptions, one render. Cheap to call from many widgets at
 * once because `useDataValue` already deduplicates per-key.
 */
export function useGameContext(): GameContext {
  const sceneRaw = useDataValue("data", "kc.scene");
  const padOccupiedRaw = useDataValue("data", "kc.padOccupied");
  const careerModeRaw = useDataValue("data", "career.mode");

  const scene: GameScene =
    typeof sceneRaw === "string" && KNOWN_SCENES.has(sceneRaw as GameScene)
      ? (sceneRaw as GameScene)
      : "Unknown";

  const careerMode: CareerMode =
    typeof careerModeRaw === "string" &&
    KNOWN_MODES.has(careerModeRaw.toUpperCase() as CareerMode)
      ? (careerModeRaw.toUpperCase() as CareerMode)
      : "Unknown";

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
