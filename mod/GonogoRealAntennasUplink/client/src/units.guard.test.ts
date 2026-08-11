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
 *
 * This package renders nothing today, so the guard has nothing to catch yet. It
 * is here anyway, and it is the one Uplink where that is more than boilerplate:
 * its channels are a decibel margin and two bit rates, both of which a first
 * widget would be tempted to print with a hand-typed "dB" or a "/ 1e6" to
 * megabits. The guard is in place before that widget is.
 */
describe("design-system: units reach a reader through <Unit>", () => {
  it("types no unit symbol next to a number", () => {
    expectNoHandTypedUnits({ dir: "src" });
  });
});
