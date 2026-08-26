import {
  type LegacyOrbitPatch,
  mapOrbitPatch,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import type {
  ManeuverFrame,
  ManeuverNode,
  VesselManeuver,
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOr } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";

/**
 * One planned maneuver node, with its burn as the three positional slots the
 * node editor works in, the basis that names them, and a cached magnitude.
 *
 * `id` is the node's OWN id, the one the update and remove commands address,
 * rather than its position in this list. A position stops being valid the
 * moment a node ahead of it is deleted, and recovering the real id from one
 * means reading the plan a second time to correlate them.
 */
export interface ParsedManeuverNode {
  id: string;
  /** The burn instant, UT seconds. */
  UT: number;
  /**
   * The burn's three components in slot order, m/s. WHICH components those are
   * is {@link frame}'s to say, and the field-name convention actively misleads:
   * under the Frenet basis slot 0 is the tangent and slot 2 is the binormal.
   */
  deltaV: [number, number, number];
  /**
   * The basis {@link deltaV}'s slots are expressed in, or null when the node
   * did not state one.
   *
   * Carried rather than dropped. Dropping it here, one function below the
   * editor that labels the slots, sends an n-body planner's Frenet burn to the
   * operator with its along-track component labelled "Radial" and its
   * out-of-plane one labelled "Prograde". Null stays null: defaulting to
   * the stock basis would assert a basis the node declined to state, on numbers
   * that may be in another one.
   */
  frame: ManeuverFrame | null;
  /** The burn's size, m/s. */
  deltaVMagnitude: number;
  /**
   * Engine light and cutoff for a FINITE burn, or null when nothing models a
   * duration. Never substituted from `UT`, so "no duration modelled" stays
   * distinguishable from an instantaneous burn.
   */
  ignitionUt: number | null;
  cutoffUt: number | null;
  /** The orbit this burn puts the craft on, as a patch chain. */
  orbitPatches: LegacyOrbitPatch[];
}

const EMPTY: readonly ParsedManeuverNode[] = [];

function parse(node: ManeuverNode): ParsedManeuverNode {
  const deltaV: [number, number, number] = [
    // 0 for an absent component: a node's burn is the vector it declares, and
    // a component nobody sent contributes nothing to it.
    magnitudeOr(node.dvRadial, 0),
    magnitudeOr(node.dvNormal, 0),
    magnitudeOr(node.dvPrograde, 0),
  ];
  return {
    id: node.id,
    UT: node.ut.magnitude,
    deltaV,
    frame: node.frame ?? null,
    // The plan's own total when it carries one, because whoever owns the plan
    // knows how it sums its burn and a client re-deriving it can only agree by
    // coincidence. The hypotenuse is the fallback for a plan that does not say.
    deltaVMagnitude:
      node.dvTotal?.magnitude ?? Math.hypot(deltaV[0], deltaV[1], deltaV[2]),
    ignitionUt: node.ignitionUt?.magnitude ?? null,
    cutoffUt: node.cutoffUt?.magnitude ?? null,
    // `?? []` because a stored recording can predate the field, and a replay
    // reads this through the same path the live stream does. Absence and empty
    // are the same thing to every reader here.
    orbitPatches: (node.patches ?? []).map(mapOrbitPatch),
  };
}

/**
 * The maneuver nodes planned on the active vessel. Empty when none are planned
 * or nothing has delivered a plan yet.
 *
 * One subscription regardless of how many nodes the vessel carries, so the
 * cost does not grow with the plan.
 *
 * Consumers wanting a live "time to burn" countdown combine `UT` with the
 * current universal time themselves: baking the subtraction in here would
 * re-render every consumer on every clock tick rather than on an actual change
 * to the plan.
 */
export function useManeuverNodes(): readonly ParsedManeuverNode[] {
  const nodes = useStream<VesselManeuver>("vessel.maneuver")?.nodes;
  return useMemo(() => {
    if (!Array.isArray(nodes) || nodes.length === 0) return EMPTY;
    return nodes.map(parse);
  }, [nodes]);
}
