import {
  type OrbitPatch,
  TransitionType,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";

/** What a node's post-burn patches say about reaching a body. */
export type EncounterCheck =
  | { kind: "pending" }
  | { kind: "none" }
  | { kind: "encounter"; body: string; periapsisAltitude: Value<"m"> };

/**
 * Whether the game's own patched conics put the craft in `target`'s sphere of
 * influence after a node, entering it or, for the body the craft's own body
 * orbits, leaving into it, and at what periapsis altitude.
 *
 * A node whose chain has not arrived reads as pending: the solver has produced
 * no post-burn patch yet, which says nothing about an encounter. Only a chain
 * that arrived and never enters the target is "none".
 */
export function checkEncounter(
  patches: readonly OrbitPatch[],
  target: string,
): EncounterCheck {
  if (patches.length === 0) return { kind: "pending" };
  const entered = patches.find(
    (p) =>
      p.referenceBody === target &&
      (p.patchStartTransition === TransitionType.Encounter ||
        p.patchStartTransition === TransitionType.Escape),
  );
  if (!entered) return { kind: "none" };
  return {
    kind: "encounter",
    body: entered.referenceBody,
    periapsisAltitude: entered.peA,
  };
}
