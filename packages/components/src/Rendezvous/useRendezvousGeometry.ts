import { useViewUt } from "@ksp-gonogo/sitrep-client";
import { TargetKind, type VesselTarget } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import { bare } from "../shared/dockAngles";
import { type CraftGeometry, craftGeometry } from "./geometry/craft";
import {
  type EncounterGeometry,
  encounterGeometry,
  timeToPeriapsis,
} from "./geometry/encounter";
import {
  approachOf,
  bodyNumbers,
  elementsOf,
  patchAround,
  patchNumbers,
} from "./geometry/telemetry";
import type { TargetClass } from "./levels";
import { rendezvousTopics } from "./useRendezvousReading";

/** Inside this range, in metres, a port target's own offset from the target's orbit-frame reading is what the circles draw; beyond it the two frames turn apart and the orbits give the figure. */
const PORT_FRAME_RANGE_M = 2000;

/** What the circles are drawn from, and the numbers the level choice reads, all from observed readings of now. */
export interface RendezvousGeometry {
  targetClass: TargetClass;
  craft: CraftGeometry | null;
  encounter: EncounterGeometry | null;
  /** The target body's name, for the readout. */
  bodyName: string | undefined;
  /** Whether the target body orbits a planet, so its disc is drawn as a moon. */
  bodyIsMoon: boolean;
  /** For a body: the range in radii of its sphere of influence. */
  rangeInSoi: number | undefined;
  /** For a body: the path already enters, or the craft is inside, its sphere of influence. */
  pathEntersBody: boolean;
  /** For a body: seconds to periapsis of the patch around it, and its altitude, metres. */
  periapsis: { inSeconds: number | null; altitude: number } | null;
}

const NONE: RendezvousGeometry = {
  targetClass: "craft",
  craft: null,
  encounter: null,
  bodyName: undefined,
  bodyIsMoon: false,
  rangeInSoi: undefined,
  pathEntersBody: false,
  periapsis: null,
};

/**
 * Reads the craft's own orbit, the target's and the body table, and works the
 * geometry out from them at the view's UT. A reading that is not observed
 * gives nothing to draw: the circles never state what is held as if it were now.
 */
export function useRendezvousGeometry(
  target: VesselTarget | undefined,
  targetObserved: boolean,
  range: number | undefined,
): RendezvousGeometry {
  const orbitReading = rendezvousTopics.useTelemetry("vessel.orbit");
  const bodiesReading = rendezvousTopics.useTelemetry("trackingStation.bodies");
  const ut = useViewUt()?.valueOf();
  const orbit =
    orbitReading.state === "observed" ? orbitReading.value : undefined;
  const bodies =
    bodiesReading.state === "observed" || bodiesReading.state === "held"
      ? bodiesReading.value.bodies
      : undefined;

  return useMemo(() => {
    if (target === undefined) return NONE;
    const targetClass: TargetClass =
      target.kind === TargetKind.Body ? "body" : "craft";
    if (!targetObserved || orbit === undefined || ut === undefined) {
      return { ...NONE, targetClass };
    }
    const chaser = elementsOf(orbit);
    const central = bodies?.find((b) => b.index === orbit.referenceBodyIndex);
    const theirs = target.orbit ? elementsOf(target.orbit) : null;
    const sharesBody =
      target.orbit !== undefined &&
      target.orbit !== null &&
      target.orbit.referenceBodyIndex === orbit.referenceBodyIndex;
    // Port to port, in the target's frame: the wire gives target minus you, in your orbit frame, which matches the target's within the range.
    const offset = target.orbitRelativePosition;
    const portRelative =
      target.kind === TargetKind.Part && offset ? bare(offset) : undefined;
    const portRange =
      portRelative === undefined
        ? undefined
        : Math.hypot(portRelative.x, portRelative.y, portRelative.z);
    // A target round another body than you draws no Far circle: there is no one frame for both paths.
    const craft =
      chaser !== null && theirs !== null && sharesBody
        ? craftGeometry({
            chaser,
            target: theirs,
            ut,
            approach: targetClass === "craft" ? approachOf(target) : null,
            bodyRadius: bodyNumbers(central)?.radius,
            relative:
              portRelative !== undefined &&
              portRange !== undefined &&
              portRange < PORT_FRAME_RANGE_M
                ? [-portRelative.x, -portRelative.y, -portRelative.z]
                : null,
          })
        : null;
    if (targetClass === "craft") return { ...NONE, targetClass, craft };
    const bodyIndex = target.bodyIndex ?? undefined;
    const body = bodies?.find((b) => b.index === bodyIndex);
    const numbers = bodyNumbers(body);
    const patch =
      bodyIndex === undefined ? undefined : patchAround(orbit, bodyIndex);
    const inside = orbit.referenceBodyIndex === bodyIndex;
    const patchValues = patch ? patchNumbers(patch) : null;
    return {
      ...NONE,
      targetClass,
      craft,
      bodyName: body?.name ?? target.name,
      bodyIsMoon:
        body?.parentIndex !== undefined &&
        body.parentIndex !== null &&
        body.parentIndex !== 0,
      rangeInSoi:
        numbers !== null && range !== undefined
          ? range / numbers.soi
          : undefined,
      pathEntersBody: patch !== undefined || inside,
      encounter:
        patchValues !== null && numbers !== null
          ? encounterGeometry(patchValues, numbers, ut)
          : null,
      periapsis: patchValues
        ? {
            inSeconds: timeToPeriapsis(patchValues, ut),
            altitude: patchValues.periapsisAltitude,
          }
        : null,
    };
  }, [target, targetObserved, orbit, bodies, ut, range]);
}
