/**
 * The levels the Rendezvous view steps through, each a circle, and the ranges
 * that move the view from one to the next. The thresholds are set once here and
 * shared by every scenario; a target in another orbit, around another body or
 * a landed one all pass through the same ones.
 */

/** One step of the zoom: the whole picture, the relative approach, the docking port, or a body's sphere of influence. */
export type RendezvousLevel = "far" | "approach" | "docking" | "encounter";

/** What the target is, as far as the levels care: a craft (a vessel, a port, an asteroid) or a body. */
export type TargetClass = "craft" | "body";

/** Levels in the order the view zooms through them for each kind of target. */
export const LEVELS_FOR: Readonly<
  Record<TargetClass, readonly RendezvousLevel[]>
> = {
  craft: ["far", "approach", "docking"],
  body: ["far", "encounter"],
};

// Distances in metres; each pair is a window, wider to leave than to enter, so a figure on the edge does not strobe.
export const APPROACH_ENTER_M = 5_000;
export const APPROACH_EXIT_M = 5_500;
export const DOCKING_ENTER_M = 100;
export const DOCKING_EXIT_M = 150;
/** The encounter scale, in radii of the body's sphere of influence, when the path has not yet entered it. */
export const ENCOUNTER_ENTER_SOI = 1.3;
export const ENCOUNTER_EXIT_SOI = 1.5;

/** What the next level is chosen from. */
export interface LevelInput {
  target: TargetClass;
  /** Range to the target, metres; undefined while it is not known. */
  range: number | undefined;
  /** A docking port is targeted and the docking channel reports it, so there is something to dock with. */
  dockingAvailable: boolean;
  /** For a body: the range in radii of its sphere of influence, undefined when either is not known. */
  rangeInSoi: number | undefined;
  /** For a body: the path already enters, or the craft is already inside, the body's sphere of influence. */
  pathEntersBody: boolean;
}

/** The first level of every target: the whole picture. */
export const FIRST_LEVEL: RendezvousLevel = "far";

/**
 * The level after `prev`, chosen from where the target is. Sticky: a level is
 * entered inside one range and left outside a wider one. A level that does not
 * belong to the target's kind (a body has no Docking) falls back to the first.
 */
export function nextLevel(
  prev: RendezvousLevel,
  input: LevelInput,
): RendezvousLevel {
  if (input.target === "body") {
    const inSoi =
      input.pathEntersBody ||
      (input.rangeInSoi !== undefined &&
        input.rangeInSoi <=
          (prev === "encounter" ? ENCOUNTER_EXIT_SOI : ENCOUNTER_ENTER_SOI));
    return inSoi ? "encounter" : FIRST_LEVEL;
  }
  const range = input.range;
  if (range === undefined || !Number.isFinite(range)) return FIRST_LEVEL;
  const dockEdge = prev === "docking" ? DOCKING_EXIT_M : DOCKING_ENTER_M;
  if (input.dockingAvailable && range <= dockEdge) return "docking";
  const approachEdge =
    prev === "approach" || prev === "docking"
      ? APPROACH_EXIT_M
      : APPROACH_ENTER_M;
  return range < approachEdge ? "approach" : FIRST_LEVEL;
}

/** Whether `level` is one the target's kind passes through. */
export function hasLevel(target: TargetClass, level: RendezvousLevel): boolean {
  return LEVELS_FOR[target].includes(level);
}

/** The level whose circle goes to the small place when `level` is large: the one just left, or none for the first. */
export function previousLevel(
  target: TargetClass,
  level: RendezvousLevel,
): RendezvousLevel | null {
  const order = LEVELS_FOR[target];
  const at = order.indexOf(level);
  return at > 0 ? order[at - 1] : null;
}

/** The level after `level` for the target's kind, or null at the last one. */
export function followingLevel(
  target: TargetClass,
  level: RendezvousLevel,
): RendezvousLevel | null {
  const order = LEVELS_FOR[target];
  const at = order.indexOf(level);
  return at >= 0 && at < order.length - 1 ? order[at + 1] : null;
}
