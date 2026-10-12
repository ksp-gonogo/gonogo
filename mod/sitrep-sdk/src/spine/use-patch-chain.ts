import { useMemo } from "react";
import type { CelestialFacts } from "./celestial-facts";
import {
  bodyOffsetAt,
  type PatchChain,
  type PatchChainPatch,
  patchChain,
} from "./patch-chain";

/**
 * What {@link usePatchChain} is asked: a chain you have already read, the body
 * to draw it about, the catalogue that places the bodies it passes, and the
 * instant on screen. Useful for drawing a vessel's predicted path through its
 * encounters on a system diagram. Used by the system view.
 *
 * @category Orbits and trajectories
 */
export interface UsePatchChainInput {
  /** The chain, such as `vessel.orbit.patches`. `undefined` or empty before one arrives. */
  patches: readonly PatchChainPatch[] | undefined;
  /** Name of the body the arcs are drawn about, or `null` while there is none. */
  frameBodyName: string | null | undefined;
  /** The system's celestial facts, or `undefined` before they arrive. */
  facts: CelestialFacts | undefined;
  /** When the catalogue stopped arriving, in UT seconds, or `null` while it is current. A body is then placed where its held pose puts it. */
  catalogueAsOfUt?: number | null;
  /** The instant on screen, in UT seconds, or `null` before there is one. */
  ut: number | null | undefined;
  /** Samples along each arc, from 2 to 128. Defaults to 64. */
  samplesPerPatch?: number;
}

/**
 * A craft's patch chain as arcs and sphere-of-influence crossings about a
 * frame body, in metres: the transfer it is on, the pass through a moon's
 * sphere of influence, the orbit it leaves on. Useful for showing the operator
 * where the craft goes next and where each encounter and escape falls. Used by
 * the system diagram for the active craft's predicted route.
 *
 * You pass the chain: the hook subscribes to nothing, so which reading counts
 * as the craft's chain is yours to decide. The game's patches are conics, so
 * pass them only while the craft's path is a conic (see `useOrbitTrajectory`).
 *
 * The same object comes back while the chain, the frame body, the catalogue
 * and `ut` are unchanged, so whatever you derive from it can be memoised by
 * identity. Every new `ut` samples the chain again, so hold `ut` to a step no
 * finer than you redraw at. An instant earlier than the chain's first patch is
 * taken as that patch's start.
 *
 * `null` when there is nothing to sample: no chain, no frame body, no
 * catalogue, or no instant.
 *
 * @category Orbits and trajectories
 */
export function usePatchChain({
  patches,
  frameBodyName,
  facts,
  catalogueAsOfUt = null,
  ut,
  samplesPerPatch,
}: UsePatchChainInput): PatchChain | null {
  return useMemo(() => {
    if (
      patches === undefined ||
      patches.length === 0 ||
      frameBodyName == null ||
      facts === undefined ||
      ut == null
    ) {
      return null;
    }
    return patchChain({
      patches,
      frameBodyName,
      ut: Math.max(ut, patches[0].startUt.valueOf()),
      offsetAt: (bodyName, at) =>
        bodyOffsetAt(facts, frameBodyName, bodyName, at, catalogueAsOfUt),
      samplesPerPatch,
    });
  }, [patches, frameBodyName, facts, catalogueAsOfUt, ut, samplesPerPatch]);
}
