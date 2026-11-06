import type { setupStreamFixture } from "./setupStreamFixture";

/** One body of the catalogue, at the surface gravity (in g) the game reports for it. */
export interface TestBody {
  name: string;
  index: number;
  surfaceGravity: number;
}

export const KERBIN: TestBody = { name: "Kerbin", index: 1, surfaceGravity: 1 };
export const MUN: TestBody = { name: "Mun", index: 2, surfaceGravity: 0.166 };

/** Puts the craft at `at` and gives the tracking station's catalogue `catalogue`. */
export function emitAt(
  fixture: ReturnType<typeof setupStreamFixture>,
  at: TestBody,
  catalogue: readonly TestBody[] = [KERBIN, MUN],
): void {
  fixture.emit("vessel.identity", {
    vesselId: "v1",
    name: "Active Vessel",
    vesselType: 0,
    situation: 1,
    parentBodyIndex: at.index,
    launchUt: 0,
  });
  fixture.emit("trackingStation.bodies", {
    bodies: catalogue.map((b) => ({
      name: b.name,
      index: b.index,
      parentIndex: 0,
      radius: 600000,
      surfaceGravity: b.surfaceGravity,
      orbit: null,
    })),
  });
}
