import { describe, expect, it } from "vitest";
import type { VesselFlight } from "./__generated__/contract";
import { magnitudeOf } from "./magnitude";
import { value } from "./unit-system/value";
import { type WireOf, wrapTypePayload } from "./wrap-units";

/**
 * A reader of a quantity field gets its magnitude or `null`, and never `NaN`.
 *
 * `NaN` is the one answer a reader cannot guard against with `??`, and every
 * comparison against it is false, so a threshold on it silently never trips.
 */
describe("magnitudeOf", () => {
  it("unwraps a quantity and passes a bare number through", () => {
    expect(magnitudeOf(value("m", 1000))).toBe(1000);
    expect(magnitudeOf(1000)).toBe(1000);
  });

  it("answers null for an absent or null field", () => {
    expect(magnitudeOf(undefined)).toBeNull();
    expect(magnitudeOf(null)).toBeNull();
  });

  it("answers null, never NaN, for a non-finite magnitude", () => {
    expect(magnitudeOf(value("m", Number.NaN))).toBeNull();
    expect(magnitudeOf(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("answers null for a field a partial vessel.flight frame did not carry, and the magnitude for one it did", () => {
    const partial = wrapTypePayload<VesselFlight>("VesselFlight", {
      orbitalSpeed: 2200,
    } as WireOf<VesselFlight>);
    expect(magnitudeOf(partial.altitudeAsl)).toBeNull();
    expect(magnitudeOf(partial.orbitalSpeed)).toBe(2200);
  });
});
