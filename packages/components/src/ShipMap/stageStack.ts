import type { ShipMapPart } from "./shipTopology";

/** One row of the staging stack: a stage number and the parts that fire or release with it. */
export interface StageEntry {
  /** KSP's staging number, the one the in-game stack labels the row with. */
  stage: number;
  /** The parts that activate in this stage, one entry per distinct part title with a count. */
  parts: { title: string; count: number }[];
  /** True for the stage the next press of the stage control fires; always false when the vessel's current stage is unknown. */
  current: boolean;
  /** True once the stage has fired, so the in-game stack no longer lists it. */
  spent: boolean;
}

/**
 * The staging stack of a craft as the in-game display lists it: highest stage
 * number first, each with the parts that activate in it. Parts with no stage
 * (null, or negative for a part that is never staged) are left out. When
 * `currentStage` is given, stages above it are marked spent and the stage equal
 * to it is marked current. Used by the Ship Map stage column and by a craft
 * about to launch in Launch and Recovery.
 */
export function buildStageStack(
  parts: readonly Pick<ShipMapPart, "stage" | "title" | "name">[],
  currentStage?: number | null,
): StageEntry[] {
  const known = typeof currentStage === "number" ? currentStage : null;
  const byStage = new Map<number, Map<string, number>>();
  for (const p of parts) {
    if (p.stage === null || p.stage < 0) continue;
    const titles = byStage.get(p.stage) ?? new Map<string, number>();
    const title = p.title || p.name;
    titles.set(title, (titles.get(title) ?? 0) + 1);
    byStage.set(p.stage, titles);
  }
  return [...byStage.entries()]
    .sort(([a], [b]) => b - a)
    .map(([stage, titles]) => ({
      stage,
      parts: [...titles.entries()].map(([title, count]) => ({ title, count })),
      current: known !== null && stage === known,
      spent: known !== null && stage > known,
    }));
}
