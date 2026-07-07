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

  it("leaves non-kinematic keys, including other raw vessel.flight fields, unchanged", () => {
    expect(mapTopic("vessel.flight.mach")).toBe("vessel.flight.mach");
    expect(mapTopic("vessel.flight.dynamicPressureKPa")).toBe(
      "vessel.flight.dynamicPressureKPa",
    );
    expect(mapTopic("vessel.identity.name")).toBe("vessel.identity.name");
    expect(mapTopic("some.unrelated.topic")).toBe("some.unrelated.topic");
  });
});
