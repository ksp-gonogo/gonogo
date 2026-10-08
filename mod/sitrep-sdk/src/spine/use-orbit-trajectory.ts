import { useRef } from "react";
import { useViewClockOptional } from "./context";
import { buildElements, mag } from "./kepler-reckoning";
import {
  type OrbitTrajectory,
  type OrbitTrajectoryInput,
  orbitTrajectory,
} from "./orbit-trajectory";

/** Length of the UT bucket an answer is held for, in game seconds. */
const BUCKET_SEC = 1;

/** Everything `orbitTrajectory` reads from the orbit, as one string, so an orbit rebuilt with the same content keys the same. */
function orbitKey(
  orbit: OrbitTrajectoryInput["orbit"],
  options: Pick<OrbitTrajectoryInput, "samples" | "readFrame"> | undefined,
  bucket: number,
): string {
  const e = buildElements(orbit);
  const h = orbit.horizon;
  const until = mag(h?.untilUt);
  const frame = options?.readFrame?.choice;
  return [
    bucket,
    e.sma,
    e.ecc,
    e.inc,
    e.lan,
    e.argPe,
    e.meanAnomalyAtEpoch,
    e.epoch,
    e.mu,
    h?.kind,
    until,
    h?.trajectoryKind,
    orbit.referenceBodyIndex,
    options?.samples,
    frame?.kind,
    frame?.bodyIndex,
  ].join("|");
}

/**
 * How the craft's path may be drawn at the instant on screen, for a
 * `vessel.orbit` value you have already read.
 *
 * Pass the whole payload, horizon included: the horizon says how far ahead the
 * elements hold, and the answer will not reach past it. You decide which
 * reading counts as the craft's orbit (observed only, or a modelled one too),
 * and the hook does not subscribe to anything itself.
 *
 * The view instant is read when your widget renders, not on every frame, so the
 * answer moves with your own telemetry. The answer is held for each whole
 * second of that instant: while the orbit's elements, horizon, sample count and
 * read frame are unchanged, every render in the same second gets the very same
 * object back, so a caller can memoise whatever it derives from it by identity.
 * An orbit whose payload is rebuilt on every render holds just as well, because
 * the key is the orbit's content and never its reference.
 *
 * `null` means the question could not be put: no elements yet, or no clock. It
 * is not a refusal, which arrives as a `withheld` answer carrying its reason, so
 * do not render the two alike.
 *
 * `readFrame` asks for the curve in a frame of your choosing, which changes
 * nothing in the game. Omit it for the frame it was computed in. Either way an
 * arc carries its `frame`, which is what to name beside it.
 *
 * @category Frames of reference
 */
export function useOrbitTrajectory(
  orbit: OrbitTrajectoryInput["orbit"] | undefined,
  options?: Pick<OrbitTrajectoryInput, "samples" | "readFrame">,
): OrbitTrajectory | null {
  /*
   * Read non-reactively: every input moves on the store frame anyway (the
   * elements, the horizon, a scrub), so an onFrame subscription would add a
   * 60 Hz re-render of a sampled path, and state updates outside act, for
   * nothing.
   */
  const clock = useViewClockOptional();
  const viewUt = clock?.viewUt();
  const held = useRef<{
    key: string;
    facts: unknown;
    answer: OrbitTrajectory;
  } | null>(null);
  if (orbit === undefined) return null;
  if (viewUt === undefined || !Number.isFinite(viewUt)) return null;
  const key = orbitKey(orbit, options, Math.floor(viewUt / BUCKET_SEC));
  const facts = options?.readFrame?.facts;
  if (held.current?.key === key && held.current.facts === facts) {
    return held.current.answer;
  }
  const answer = orbitTrajectory({
    orbit,
    viewUt,
    samples: options?.samples,
    readFrame: options?.readFrame,
  });
  held.current = { key, facts, answer };
  return answer;
}
