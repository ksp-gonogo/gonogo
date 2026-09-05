// Everything a shared Processor needs, imported the ONLY way an Uplink is
// allowed to import it: from `@ksp-gonogo/sitrep-sdk`, with no `/spine` subpath
// and nothing app-side. If this file compiles and runs, a third-party author can
// consume these handles too.
import {
  bodyAtIndex,
  CELESTIAL_FACTS,
  type CelestialFacts,
  DELTA_V_BUDGET,
  type DeltaVBudget,
  deriveCelestialFacts,
  deriveDeltaVBudget,
  useProcessor,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";

/**
 * Cross-Uplink reach for the shared Processors, proved from inside an Uplink
 * rather than asserted from outside one.
 *
 * `registerProcessor` stamps an owner, so "shareable in principle" was already
 * true of the ID namespace. What was NOT established is whether a consumer can
 * NAME a handle it did not declare: `useProcessor` infers its result from the
 * handle's phantom brand, so without the handle and its result type an Uplink
 * gets `unknown` at best.
 *
 * This is the arrangement that makes it work, and it only works for a processor
 * whose CONTRACT is declared in the SDK. An Uplink still cannot consume a
 * processor another Uplink declared: those live in `mod/Gonogo*Uplink/client`,
 * none of which is a published package, so neither the handle nor its result
 * type is reachable, and no registry keyed by id can close that gap because a
 * declaration merge is scoped to a TypeScript program and Uplink B's program can
 * never include Uplink A's declaration file. `TopicPayloadMap` has the same
 * limit, and one Uplink cannot type another's Topic either.
 *
 * What DID close is the separable half: `defineProcessorContract` publishes the
 * id and the result type from the SDK for an implementation that registers
 * elsewhere, so the type lives where every Uplink compiles against it while the
 * derivation lives with the mod it derives from. The second describe block
 * below runs that end to end from inside an Uplink, over the real evaluator.
 */
describe("an Uplink can reach the SDK's shared Processors", () => {
  it("imports both handles, their result types, and useProcessor", () => {
    // Owner-stamped by `CORE_UPLINK_CLIENT`, which is what keeps two Uplinks
    // declaring the same local id from colliding.
    expect(CELESTIAL_FACTS.id).toBe("core:celestial-facts");
    expect(DELTA_V_BUDGET.id).toBe("core:delta-v-budget");
    expect(typeof useProcessor).toBe("function");
  });

  it("runs the pure derivations directly, without a host or an evaluator", () => {
    // The "called directly by a Contribution (pure)" half of the Processor
    // primitive: an Uplink that wants the answer inside its own `compute` does
    // not have to stand up a frame source to get it.
    const facts: CelestialFacts = deriveCelestialFacts(
      [
        // The root body's parent is absent on the wire, not null: the contract
        // types it optional.
        { index: 0, name: "Kerbol", parentIndex: undefined },
        { index: 1, name: "Kerbin", parentIndex: 0 },
      ],
      0,
    );
    expect(facts.nameByIndex).toEqual({ 0: "Kerbol", 1: "Kerbin" });
    expect(bodyAtIndex(facts, 1)?.name).toBe("Kerbin");

    const budget: DeltaVBudget = deriveDeltaVBudget(
      { state: "pending", reckoning: "none" },
      [{ stage: 0, dvVac: 1200 }],
      0,
      0,
    );
    expect(budget.stages[0].deltaVVac).toBe(1200);
    // Withheld rather than invented: the summary never arrived, and the client
    // does not add the stage rows up to cover for it.
    expect(budget.totalVac).toBeNull();
  });
});
