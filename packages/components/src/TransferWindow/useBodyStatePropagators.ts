import type { StateLike } from "@ksp-gonogo/core";
import { useBodyStates } from "@ksp-gonogo/sitrep-client";
import {
  type BodyState,
  PropagationCertification,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { usePanelDelay } from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import type { PorkchopAxes } from "./transferData";

/** A body's identity and parent: all this hook needs to ask the game. */
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
 * they do not line up one to one. Positional, since a round-tripped float UT
 * would miss every lookup keyed on the value sent.
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

/** Unreachable fallback for a total lookup: at the origin, so a cell built from it scores no transfer. */
const ORIGIN_UNKNOWN: StateLike = {
  position: [0, 0, 0],
  velocity: [0, 0, 0],
};

/**
 * Where the two bodies are on a porkchop's own time axes, asked of the game's
 * elected propagation provider rather than solved in the browser. Requests are
 * `Unbounded`: a transfer search asks about instants nobody has reached. One
 * batched dispatch per body.
 *
 * Null unless it can deliver the WHOLE of both axes, since a half-provider,
 * half-local grid would put a seam through the Δv surface. `axes` must be
 * memoised by the caller: a new identity dispatches again.
 */
export function useBodyStatePropagators(
  origin: BodyRef | null,
  dest: BodyRef | null,
  bodies: BodyRef[],
  axes: PorkchopAxes | null,
): BodyStatePropagators | null {
  const { solve, handle } = useBodyStates();
  // TrueNow and delay-free, but `useCommand` asserts every dispatching handle reaches the rail.
  usePanelDelay(handle);
  const [resolved, setResolved] = useState<BodyStatePropagators | null>(null);

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

    // The one place the plain-number axes meet the command's `Value<"ut">` instants.
    const asUts = (uts: number[]) => uts.map((ut) => value("ut", ut));

    const ask = async () => {
      try {
        const [originReply, destReply] = await Promise.all([
          solve({
            bodyIndex: originIndex,
            centreBodyIndex: centreIndex,
            uts: asUts(departureUts),
            certification: PropagationCertification.Unbounded,
          }),
          solve({
            bodyIndex: destIndex,
            centreBodyIndex: centreIndex,
            uts: asUts(arrivalUts),
            certification: PropagationCertification.Unbounded,
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
        // A dispatch that never left is a network fact; the caller draws the local conic.
        if (live) {
          setResolved(null);
        }
      }
    };
    void ask();
    return () => {
      live = false;
    };
  }, [originIndex, destIndex, centreIndex, axes, solve]);

  return resolved;
}
