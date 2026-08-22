// Imported the ONLY way an Uplink is allowed to: the SDK root barrel and its
// testing subpath, nothing app-side, no other Uplink.
import {
  defineProcessorContract,
  defineUplinkClient,
  useProcessor,
} from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

/**
 * A Processor whose CONTRACT is published and whose IMPLEMENTATION is not,
 * consumed from inside an Uplink that imports neither the implementer nor its
 * types.
 *
 * This is the whole of what "shareable across Uplinks" can mean, and the
 * boundary is a TypeScript one rather than a policy one. `useProcessor` reads
 * its result type off the handle's phantom brand, so a consumer needs the
 * handle; an Uplink lives in an unpublished package, so another Uplink cannot
 * import its handle; and a declaration-merged registry keyed by id cannot
 * substitute, because a merge is scoped to a PROGRAM and Uplink B's program can
 * never include Uplink A's declaration file. `TopicPayloadMap` runs into the
 * same wall, which is why one Uplink cannot type another's Topic either.
 *
 * What is left is the split below: the id and the result type in the SDK, where
 * every Uplink already compiles against them, and the derivation wherever the
 * mod it derives from lives. `othermod` here stands for an Uplink this package
 * has no dependency on and never names outside a string literal, which is the
 * point: the rendezvous is the owner-stamped id, and nothing is imported across
 * the boundary in either direction.
 *
 * The two cases run in order deliberately. The same contract has to answer
 * `undefined` before an implementation exists and the real value after, and
 * splitting them across contracts would prove neither.
 */

/** The result type, as the SDK would publish it beside the contract. */
interface HabSummary {
  readonly occupied: number;
  readonly derivedForUt: number;
}

const HAB_SUMMARY = defineProcessorContract<HabSummary>("othermod:hab-summary");

const unmounts: Array<() => void> = [];

afterEach(() => {
  for (const unmount of unmounts) unmount();
  unmounts.length = 0;
});

function watch(): { readonly latest: HabSummary | undefined } {
  const fixture = setupStreamFixture({ carriedChannels: [], pinnedUt: 42 });
  // Annotated, not inferred: an untyped `let seen` would accept `unknown` and
  // this file would go on passing if the brand ever stopped carrying `R`, which
  // is the failure it exists to catch.
  let seen: HabSummary | undefined;
  function Probe() {
    seen = useProcessor(HAB_SUMMARY);
    return null;
  }
  const result = render(
    <fixture.Provider>
      <Probe />
    </fixture.Provider>,
  );
  unmounts.push(result.unmount);
  act(() => {
    fixture.store.beginFrame();
  });
  return {
    get latest() {
      return seen;
    },
  };
}

describe("a Processor contract with no implementation registered", () => {
  it("is undefined rather than a crash, so an absent mod degrades", () => {
    // Exactly what `useProcessor` answers before the first frame, which every
    // consumer already handles. That is why the absent-implementation case
    // needs no presence check bolted onto the contract.
    expect(watch().latest).toBeUndefined();
  });
});

describe("the same contract, once some other Uplink implements it", () => {
  it("carries the implementation's value, typed by the contract's own R", () => {
    // What the OTHER Uplink's own module-load registration does. It imports
    // `HabSummary` from where the contract is published and annotates `compute`
    // with it; declaring the shape twice, once each side, is the failure the
    // contract exists to prevent.
    const OTHERMOD = defineUplinkClient({
      id: "othermod",
      version: "0.0.1",
      name: "Other Mod",
    });
    OTHERMOD.registerProcessor({
      id: "hab-summary",
      deps: [] as const,
      compute: (_values, frame): HabSummary => ({
        occupied: 3,
        derivedForUt: frame.viewUt,
      }),
    });

    const watched = watch();

    expect(watched.latest?.occupied).toBe(3);
    // Off the real evaluator's frame, not a stub: the contract handle resolved
    // to a registered definition and it ran for the frame's own view time.
    expect(watched.latest?.derivedForUt).toBe(42);
  });
});

describe("the contract id", () => {
  it("refuses an id that is not owner-stamped, because the failure is silent otherwise", () => {
    // An unstamped id can never match what `registerProcessor` stamps, so the
    // handle would answer `undefined` forever, which is indistinguishable from
    // the implementing mod not being installed: the one case the contract is
    // supposed to make legible.
    expect(() => defineProcessorContract<HabSummary>("hab-summary")).toThrow(
      /owner-stamped/,
    );
  });
});
