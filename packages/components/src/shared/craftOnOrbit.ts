import { type OrbitalSolve, solveOrbit } from "@ksp-gonogo/sitrep-client";
import type { Reading, VesselOrbit } from "@ksp-gonogo/sitrep-sdk";
import { derivedMarking } from "@ksp-gonogo/ui-kit";
import type { CraftOnOrbit } from "./OrbitDiagram";

/** The elements a place on the orbit is solved from. */
type ObservedElements = Pick<
  VesselOrbit,
  | "sma"
  | "ecc"
  | "inc"
  | "lan"
  | "argPe"
  | "meanAnomalyAtEpoch"
  | "epoch"
  | "mu"
>;

/**
 * Where the craft is drawn on its own orbit, one place for each way the
 * reading knows it.
 *
 * The observation's place is solved at the elements' own epoch, which is where
 * the craft was when they were taken. `solve` is the orbit at the view's
 * instant, so it is the craft's place now wherever the reading is current, and
 * the model's wherever a model carried it there. A held reading no model
 * carries has only its last place, drawn held.
 */
export function craftOnOrbit(
  reading: Reading<unknown>,
  /** The elements the reading last observed, without a model's overlay. */
  observed: ObservedElements | undefined,
  solve: Pick<OrbitalSolve, "trueAnomaly"> | null,
): CraftOnOrbit | null {
  if (observed === undefined) return null;
  const observedAt = solveOrbit(
    observed,
    observed.epoch,
    undefined,
  ).trueAnomaly;
  const marking = derivedMarking(reading);
  if (marking === null) {
    return { current: solve?.trueAnomaly ?? observedAt };
  }
  if (marking.kind === "held") return { held: observedAt };
  return {
    [reading.state === "observed" ? "current" : "held"]: observedAt,
    modelled: solve?.trueAnomaly,
  };
}
