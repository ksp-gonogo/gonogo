import { describe, expect, it } from "vitest";
import { canPropagate, PropagationHorizonKindLike as Kind } from "./kepler";

/**
 * The client half of the propagation seam. Mod-side `CanPropagate` has taken a
 * window since it shipped so that a provider with a horizon could decline; these
 * pin what the client does with that answer.
 */
describe("canPropagate", () => {
  it("permits any window when a provider states it has no horizon", () => {
    // The live case today: the only elected provider is the analytic two-body
    // solver, which genuinely has no limit and says so.
    expect(canPropagate({ kind: Kind.Unbounded }, 0, 1e12)).toEqual({
      propagatable: true,
    });
  });

  it("REFUSES when nobody stated a horizon", () => {
    // The arm the enum ordering exists for. `Unspecified` is 0, so a producer
    // that forgets the field lands here rather than on `Unbounded`: the refusing
    // answer rather than "trust this conic forever".
    expect(canPropagate({ kind: Kind.Unspecified }, 100, 200)).toEqual({
      propagatable: false,
      reason: "no-horizon-stated",
    });
  });

  it("permits a window inside a stated horizon and refuses one past it", () => {
    const horizon = { kind: Kind.Until, untilUt: 1_000 };

    expect(canPropagate(horizon, 100, 999)).toEqual({ propagatable: true });
    expect(canPropagate(horizon, 100, 1_000)).toEqual({ propagatable: true });
    expect(canPropagate(horizon, 100, 1_001)).toEqual({
      propagatable: false,
      reason: "past-horizon",
      horizonUt: 1_000,
    });
  });

  it("refuses a window whose START is past the horizon, not just its end", () => {
    // A caller sweeping backwards passes fromUt > toUt. Checking only `toUt`
    // would let it propagate from well beyond the horizon back to inside it.
    const horizon = { kind: Kind.Until, untilUt: 1_000 };
    expect(canPropagate(horizon, 5_000, 900)).toEqual({
      propagatable: false,
      reason: "past-horizon",
      horizonUt: 1_000,
    });
  });

  it("refuses an Until horizon that never names its UT", () => {
    // The arm claims a bound and then fails to state it. Reading that as
    // unbounded would be the same coercion one layer down.
    expect(canPropagate({ kind: Kind.Until }, 0, 1)).toEqual({
      propagatable: false,
      reason: "no-horizon-stated",
    });
    expect(
      canPropagate({ kind: Kind.Until, untilUt: Number.NaN }, 0, 1),
    ).toEqual({ propagatable: false, reason: "no-horizon-stated" });
    expect(
      canPropagate(
        { kind: Kind.Until, untilUt: Number.POSITIVE_INFINITY },
        0,
        1,
      ),
    ).toEqual({ propagatable: false, reason: "no-horizon-stated" });
  });

  it("reads a wrapped UT as well as a bare one", () => {
    // The wire delivers `untilUt` as a `Value<"ut">`; a caller holding an
    // already-unwrapped number should not have to re-wrap it to ask.
    expect(
      canPropagate({ kind: Kind.Until, untilUt: { magnitude: 500 } }, 0, 400),
    ).toEqual({ propagatable: true });
    expect(
      canPropagate({ kind: Kind.Until, untilUt: { magnitude: 500 } }, 0, 600),
    ).toEqual({ propagatable: false, reason: "past-horizon", horizonUt: 500 });
  });
});
