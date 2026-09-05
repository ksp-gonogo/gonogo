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
   * True when the active vessel is in `PRELAUNCH` situation, false when it is
   * confirmed not to be. Implies `inFlight` (KSP only sets PRELAUNCH after the
   * flight scene loads).
   *
   * `undefined` when nothing has reported occupancy yet. A gate reading
   * `!padOccupied` would otherwise proceed on a dropped frame, because
   * "the pad is clear" and "we have not heard" were one value.
   *
   * `scene` and this arrive on different channels, so they can disagree for a
   * frame or two around a scene change. The context reports both as read
   * rather than reconciling them: inventing a scene from an occupancy (or
   * suppressing an occupancy that contradicts the scene) would be this hook
   * asserting something neither channel said.
   */
  padOccupied: boolean | undefined;
  /**
   * The save's career mode. `"Unknown"` when the value hasn't
   * arrived yet. Sandbox saves are a meaningful state to detect
   * (gate career-only widgets): don't lump it in with Unknown.
   */
  careerMode: CareerMode;
  /** True when careerMode is `"CAREER"` or `"SCIENCE"`, i.e. funds and/or science meaningful. */
  isCareerLike: boolean;
  /**
   * Whether spending career funds actually costs anything in this mode. Only
   * CAREER charges funds; SANDBOX and SCIENCE do not.
   *
   * An unknown mode counts as charging. A widget guarding a spend has to decide
   * what to do before the mode arrives, and permitting the spend is the wrong
   * direction to be wrong in: a craft's cost is a property of the craft and
   * arrives in every mode, so the alternative is an affordability check with
   * nothing to check against.
   */
  chargesFunds: boolean;
  /** As `chargesFunds`, for science points: CAREER and SCIENCE both charge them. */
  chargesScience: boolean;
  /**
   * True when we have telemetry but no live game context (no flight,
   * no save). Used by widgets to decide whether to dim, distinguishes
   * "data sources connected but nothing happening" from "data sources
   * still booting up".
   *
   * Any of the three reads answering at all counts, including a pad occupancy
   * reported `false`: hearing "the active vessel is not in prelaunch" is
   * hearing from the game.
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
 * Sandbox 0 / Career 1 / Science 2 / Unknown 3), index-matched so the
 * mapped `career.mode.mode` ordinal resolves via a plain array lookup.
 */
export const GAME_MODE_ORDINAL: readonly CareerMode[] = [
  "SANDBOX",
  "CAREER",
  "SCIENCE",
  "Unknown",
];

/**
 * `career.mode` (P4a D1) reads through two possible shapes depending on
 * whether the read routed to the stream or the legacy `DataSource`:
 *  - **legacy** (GonogoTelemetry's flat `career.mode` key): a plain
 *    string (`"CAREER"`/`"SCIENCE"`/`"SANDBOX"`, any casing).
 *  - **stream** (mapped to `career.mode.mode`: see `map-topic.ts`): the
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
 * single hook to decide whether their own data is "live", most flight
 * widgets dim themselves outside `Flight`, career-only widgets dim
 * outside `isCareerLike`, etc.
 *
 * Three subscriptions, one render. Cheap to call from many widgets at
 * once because `useDataValue` already deduplicates per-key.
 */
export function useGameContext(): GameContext {
  // Canonical Topic reads (former flat kc.*/career.* keys resolved
  // through map-topic.ts): kc.scene -> spaceCenter.scene.scene and
  // career.mode -> career.mode.mode (the numeric GameMode ordinal
  // resolveCareerMode below maps to a display string), both plain one-arg
  // Topic reads; kc.padOccupied -> the DERIVED spaceCenter.state channel
  // (space-center-state.ts, off spaceCenter.launchSites), read via useStream.
  // Both are DISCRETE game states that change by event, and both are declared
  // unmodellable, so neither ever carries a reckoning and the only question is
  // what a stale one means. The answer is: it is still true. The game does not leave
  // the Flight scene or stop being a career because a telemetry frame went
  // missing, and every widget downstream uses this to decide whether to DIM
  // itself, so treating a stale scene as unknown would blank half the dashboard
  // on one dropped frame. Nothing-ever-arrived stays `undefined` and falls
  // through to "Unknown", which is the honest answer to not knowing yet.
  const sceneReading = useTelemetry("spaceCenter.scene");
  const sceneRaw =
    sceneReading.state === "observed" || sceneReading.state === "stale"
      ? sceneReading.value.scene
      : undefined;
  // `null` (the list carried no occupancy) and `undefined` (no derived state
  // yet) are the same answer to a caller: nobody has told us.
  const padOccupiedRaw =
    useStream<SpaceCenterState>("spaceCenter.state")?.padOccupied ?? undefined;
  const careerModeReading = useTelemetry("career.mode");
  const careerModeRaw =
    careerModeReading.state === "observed" ||
    careerModeReading.state === "stale"
      ? careerModeReading.value.mode
      : undefined;

  const scene: GameScene =
    typeof sceneRaw === "string" && KNOWN_SCENES.has(sceneRaw as GameScene)
      ? (sceneRaw as GameScene)
      : "Unknown";

  const careerMode: CareerMode = resolveCareerMode(careerModeRaw);

  const inFlight = scene === "Flight";
  const padOccupied = padOccupiedRaw;
  const isCareerLike = careerMode === "CAREER" || careerMode === "SCIENCE";
  const chargesFunds = careerMode === "CAREER" || careerMode === "Unknown";
  const chargesScience = careerMode !== "SANDBOX";
  const hasGameSignal =
    scene !== "Unknown" ||
    careerMode !== "Unknown" ||
    padOccupied !== undefined;

  return {
    scene,
    inFlight,
    padOccupied,
    careerMode,
    isCareerLike,
    chargesFunds,
    chargesScience,
    hasGameSignal,
  };
}
