import { expectNoHandTypedUnits } from "@ksp-gonogo/ui-kit/guards";
import { describe, it } from "vitest";

/**
 * The design-system guard every Uplink should carry, and the one an Uplink
 * outside this repo copies verbatim. See `docs/creating-an-uplink.md`.
 *
 * It exists because these Uplinks are what happens without it. The app's own
 * ratchet globbed `packages/` and stopped, so while every widget in the app
 * moved to `<Unit>`, three Uplinks kept writing their own symbols: a signal
 * badge doing its own `* 100`, a coverage readout, two latitudes, and a
 * hand-rolled metres-to-km divide in three places. Nothing was wrong with the
 * authors; nothing was watching.
 *
 * A hand-typed symbol renders fine and type-checks fine. What it cannot do is
 * follow the value's ladder when the magnitude changes rung, keep itself off a
 * line break, take the readout's own colour, or be announced as a word instead
 * of as its letters.
 */
describe("design-system: units reach a reader through <Unit>", () => {
  it("types no unit symbol next to a number", () => {
    expectNoHandTypedUnits({ dir: "src" });
  });
});
