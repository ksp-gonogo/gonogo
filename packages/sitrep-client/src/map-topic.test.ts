import { describe, expect, it } from "vitest";
import { mapTopic } from "./map-topic";

describe("mapTopic", () => {
  it("routes short kinematic keys onto vessel.state.*", () => {
    expect(mapTopic("altitude")).toBe("vessel.state.altitudeAsl");
    expect(mapTopic("altitudeAsl")).toBe("vessel.state.altitudeAsl");
    expect(mapTopic("position")).toBe("vessel.state.position");
    expect(mapTopic("velocity")).toBe("vessel.state.velocity");
    expect(mapTopic("orbitalSpeed")).toBe("vessel.state.orbitalSpeed");
  });

  it("redirects a widget asking for the raw altitude topic directly onto the derived surface (V-12 prevention)", () => {
    expect(mapTopic("vessel.flight.altitudeAsl")).toBe(
      "vessel.state.altitudeAsl",
    );
  });

  it("redirects a widget asking for the raw orbital-speed topic directly onto the derived surface — the real raw twin lives on vessel.flight, not vessel.orbit (elements-only, no orbitalSpeed field)", () => {
    expect(mapTopic("vessel.flight.orbitalSpeed")).toBe(
      "vessel.state.orbitalSpeed",
    );
  });

  it("leaves non-kinematic keys, including other raw vessel.flight fields, unchanged", () => {
    expect(mapTopic("vessel.flight.mach")).toBe("vessel.flight.mach");
    expect(mapTopic("vessel.flight.dynamicPressureKPa")).toBe(
      "vessel.flight.dynamicPressureKPa",
    );
    expect(mapTopic("vessel.identity.name")).toBe("vessel.identity.name");
    expect(mapTopic("some.unrelated.topic")).toBe("some.unrelated.topic");
    // vessel.orbit is elements-only (referenceBodyIndex/sma/ecc/inc/lan/
    // argPe/meanAnomalyAtEpoch/epoch/mu) — it never had an orbitalSpeed
    // field, so nothing should route away from it under that name either.
    expect(mapTopic("vessel.orbit.orbitalSpeed")).toBe(
      "vessel.orbit.orbitalSpeed",
    );
  });
});
