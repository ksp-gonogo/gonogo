import type { BodyPlace } from "../shared/streamBody";
import { apparentSize, detailFromApparentSize } from "./pencilSketch";

export type RosterBody = BodyPlace;

/** How much more detail a body gets once a craft is flying at it. */
export const VISITED_DETAIL_STEP = 0.2;

function ancestry(
  roster: readonly RosterBody[],
  body: RosterBody,
): RosterBody[] {
  const chain = [body];
  for (let next = body; next.parentIndex != null; ) {
    const parent = roster.find((b) => b.index === next.parentIndex);
    if (!parent || chain.includes(parent)) break;
    chain.push(parent);
    next = parent;
  }
  return chain;
}

/**
 * The distance in metres at which the home body sees `target`: the
 * semi-major axis of the target's branch below the two bodies' nearest common
 * parent, combined at right angles with the home body's own branch. A moon of
 * the home body gives the moon's orbit, a planet gives the two planets' orbits
 * about the star. `undefined` when the roster does not carry the orbits that
 * answer it.
 */
export function distanceFromHome(
  roster: readonly RosterBody[],
  home: RosterBody,
  target: RosterBody,
): number | undefined {
  if (home === target) return 0;
  const homeChain = ancestry(roster, home);
  const targetChain = ancestry(roster, target);
  const common = targetChain.findIndex((b) => homeChain.includes(b));
  if (common < 0) return undefined;
  const branch = (chain: RosterBody[], upTo: number): number | undefined => {
    // The body just below the common parent is the one whose orbit spans the gap.
    if (upTo === 0) return 0;
    return chain[upTo - 1].sma;
  };
  const targetLeg = branch(targetChain, common);
  const homeLeg = branch(homeChain, homeChain.indexOf(targetChain[common]));
  if (targetLeg === undefined || homeLeg === undefined) return undefined;
  return Math.hypot(targetLeg, homeLeg);
}

/**
 * How finely the map of `target` is sketched, 0 to 1. The home body is always
 * 1; any other body falls off with how small it looks from home, and a body
 * the roster cannot place is drawn in full. A craft flying at the body lifts it
 * by {@link VISITED_DETAIL_STEP}.
 */
export function bodyDetail(
  roster: readonly RosterBody[] | undefined,
  target: string | null | undefined,
  visited: boolean,
): number {
  if (!roster || !target) return 1;
  const body = roster.find((b) => b.name === target);
  const home = roster.find((b) => b.isHome);
  if (!body || !home) return 1;
  const radius = body.radius;
  const distance = distanceFromHome(roster, home, body);
  if (radius === undefined || distance === undefined || distance <= 0) return 1;
  const natural = detailFromApparentSize(apparentSize(radius, distance));
  return Math.min(1, natural + (visited ? VISITED_DETAIL_STEP : 0));
}
