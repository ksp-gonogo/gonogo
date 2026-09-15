import type { StateLike } from "@ksp-gonogo/core";
import { useBodyStates } from "@ksp-gonogo/sitrep-client";
import { type BodyState, TrajectoryKind } from "@ksp-gonogo/sitrep-sdk";
import { usePanelDelay } from "@ksp-gonogo/ui-kit";
import { useEffect, useRef, useState } from "react";
import type { PorkchopAxes } from "./transferData";

/**
 * What this hook reads off a body, which is its identity and its parent and
 * nothing else. Declared rather than taking `CelestialBody` so the shape says
 * what is actually needed: the elements, the atmosphere and the rest belong to
 * the widget's own arithmetic, not to a question the game answers.
 */
export interface BodyRef {
  index: number;
  name: string | null;
  referenceBody: string | null;
}

export interface BodyStatePropagators {
  propagateOrigin: (ut: number) => StateLike;
  propagateDest: (ut: number) => StateLike;
}

/** The index of the body both endpoints orbit, or null when they do not share one. */
function sharedParentIndex(
  origin: BodyRef,
  dest: BodyRef,
  bodies: BodyRef[],
): number | null {
  if (!origin.referenceBody || origin.referenceBody !== dest.referenceBody) {
    return null;
  }
  const parent = bodies.find((b) => b.name === origin.referenceBody);
  return parent ? parent.index : null;
}

/**
 * The reply's states against the instants they were asked for, or null when
 * they do not line up one to one.
 *
 * Positional rather than matched on `ut`, which the contract promises and
 * which is the only way this can work: the UTs are floats that made a round
 * trip, and a map keyed on the value that came BACK would miss every lookup
 * the grid makes with the value it sent.
 */
function statesByUt(
  uts: number[],
  states: BodyState[] | undefined,
): Map<number, StateLike> | null {
  if (!states || states.length !== uts.length) {
    return null;
  }
  const byUt = new Map<number, StateLike>();
  for (let i = 0; i < uts.length; i++) {
    const s = states[i];
    byUt.set(uts[i], {
      position: [s.x.magnitude, s.y.magnitude, s.z.magnitude],
      velocity: [s.vx.magnitude, s.vy.magnitude, s.vz.magnitude],
    });
  }
  return byUt;
}

/**
 * The state for an instant nobody asked about, which `statesByUt`'s length
 * check means the grid cannot reach: it looks up only the UTs the map was
 * built from. Present because the lookup is typed total, at the origin so a
 * cell built from it is degenerate and scores no transfer rather than
 * inventing one.
 */
const ORIGIN_UNKNOWN: StateLike = {
  position: [0, 0, 0],
  velocity: [0, 0, 0],
};

/**
 * Where the two bodies are on a porkchop's own time axes, asked of the game's
 * elected propagation provider rather than solved in the browser.
 *
 * The analytical model is named on every request rather than left to the
 * install's default: a transfer search is a two-body question by design, and a
 * grid that silently changed model when a default moved would look like the
 * transfer itself had changed.
 *
 * Two dispatches per grid, one per body, each batching that body's whole axis:
 * a 32x32 grid is 64 body solves whichever side does them, and batching is
 * what keeps it from being 64 round trips.
 *
 * Answers null whenever it cannot deliver the WHOLE of both axes, which is
 * every case the caller falls back to the local conic for: no stream mounted,
 * no elected provider, the two bodies not sharing a parent, or a reply that
 * does not line up with what was asked. A half-provider, half-local grid would
 * put a seam through the middle of a Δv surface, so a partial answer is
 * treated as none.
 *
 * `axes` must be memoised by the caller, because a fresh object is a fresh
 * question: a new identity per render dispatches a pair of commands per frame.
 * `porkchopAxes` is already behind the same `useMemo` (on the same quantised
 * UTs) as the grid the axes describe, which is what makes that hold.
 */
export function useBodyStatePropagators(
  origin: BodyRef | null,
  dest: BodyRef | null,
  bodies: BodyRef[],
  axes: PorkchopAxes | null,
): BodyStatePropagators | null {
  const { solve, handle } = useBodyStates();
  // The command is TrueNow and carries no delay, so this contributes nothing
  // to the rail. It is still called, because `useCommand` asserts that every
  // dispatching handle reaches it and offers no opt-out: a command that could
  // skip the rail by claiming to be instant is how a delayed one eventually
  // does too.
  usePanelDelay(handle);
  const [resolved, setResolved] = useState<BodyStatePropagators | null>(null);

  // `solve` is keyed on the command handle, which `useCommand` rebuilds every
  // render, so an effect depending on it would fire on every render, land a
  // reply, re-render, and fire again: a pair of commands per frame, forever.
  // Held by ref so the dispatch always uses the current one while the effect
  // keys only on what was actually asked.
  const solveRef = useRef(solve);
  solveRef.current = solve;

  const originIndex = origin?.index ?? null;
  const destIndex = dest?.index ?? null;
  const centreIndex =
    origin && dest ? sharedParentIndex(origin, dest, bodies) : null;

  useEffect(() => {
    if (
      originIndex == null ||
      destIndex == null ||
      !axes ||
      centreIndex == null
    ) {
      setResolved(null);
      return;
    }

    let live = true;
    const departureUts = axes.departureUts;
    const arrivalUts = axes.arrivalUts;

    const ask = async () => {
      try {
        const dispatch = solveRef.current;
        const [originReply, destReply] = await Promise.all([
          dispatch({
            bodyIndex: originIndex,
            centreBodyIndex: centreIndex,
            uts: departureUts,
            model: TrajectoryKind.Analytic,
          }),
          dispatch({
            bodyIndex: destIndex,
            centreBodyIndex: centreIndex,
            uts: arrivalUts,
            model: TrajectoryKind.Analytic,
          }),
        ]);
        if (!live) {
          return;
        }
        const originStates = originReply.solved
          ? statesByUt(departureUts, originReply.states)
          : null;
        const destStates = destReply.solved
          ? statesByUt(arrivalUts, destReply.states)
          : null;
        if (!originStates || !destStates) {
          setResolved(null);
          return;
        }
        setResolved({
          propagateOrigin: (ut) => originStates.get(ut) ?? ORIGIN_UNKNOWN,
          propagateDest: (ut) => destStates.get(ut) ?? ORIGIN_UNKNOWN,
        });
      } catch {
        /*
         * A dispatch that never left is a network fact, not an answer about
         * the solar system; the caller draws the local conic rather than
         * putting an error over a chart.
         */
        if (live) {
          setResolved(null);
        }
      }
    };
    void ask();
    return () => {
      live = false;
    };
  }, [originIndex, destIndex, centreIndex, axes]);

  return resolved;
}
