import { describe, expect, it } from "vitest";
import {
  isKnownFieldPath,
  mapTopic,
  redirectKinematicSubtopic,
} from "./map-topic";

describe("isKnownFieldPath", () => {
  it("resolves a contract field that no legacy key ever named", () => {
    // The half the migration table cannot carry. `reputationDecayPerDay` is a
    // field the wire gained after the migration began, so it has no legacy
    // predecessor to be the new home of, and a widget declaring it had nothing
    // to validate against.
    expect(
      isKnownFieldPath("career.status.economy.reputationDecayPerDay"),
    ).toBe(true);
    expect(isKnownFieldPath("career.status.economy.upkeep")).toBe(true);
    expect(
      isKnownFieldPath("career.status.economy.upkeep.launchComplexes"),
    ).toBe(true);
  });

  it("still resolves a derived-channel field, which no contract type declares", () => {
    expect(isKnownFieldPath("vessel.state.altitudeAsl")).toBe(true);
  });

  it("rejects a plausible name the contract does not declare", () => {
    // The positive control. A walk that returned true here would make every
    // declaration gate downstream of it vacuous.
    expect(isKnownFieldPath("career.status.economy.notAField")).toBe(false);
    expect(isKnownFieldPath("career.status.economy.upkeep.notASource")).toBe(
      false,
    );
    expect(isKnownFieldPath("vessel.state.notAField")).toBe(false);
    expect(isKnownFieldPath("notATopic.atAll")).toBe(false);
  });

  it("stops at a collection rather than guessing past its key", () => {
    // `facilities` is a dynamic-key map, so what follows it is a facility name
    // the contract never lists. The collection itself is a real field; a path
    // through it cannot be judged, and guessing is worse than declining.
    expect(isKnownFieldPath("career.status.facilities")).toBe(true);
    expect(isKnownFieldPath("career.status.facilities.LaunchPad.maxTier")).toBe(
      false,
    );
  });
});

describe("redirectKinematicSubtopic (T3: new-SDK topic safety net)", () => {
  it("routes short kinematic keys onto vessel.state.*", () => {
    expect(redirectKinematicSubtopic("altitude")).toBe(
      "vessel.state.altitudeAsl",
    );
    expect(redirectKinematicSubtopic("altitudeAsl")).toBe(
      "vessel.state.altitudeAsl",
    );
    expect(redirectKinematicSubtopic("position")).toBe("vessel.state.position");
    expect(redirectKinematicSubtopic("velocity")).toBe("vessel.state.velocity");
    expect(redirectKinematicSubtopic("orbitalSpeed")).toBe(
      "vessel.state.orbitalSpeed",
    );
  });

  it("redirects a widget asking for the raw altitude topic directly onto the derived surface (V-12 prevention)", () => {
    expect(redirectKinematicSubtopic("vessel.flight.altitudeAsl")).toBe(
      "vessel.state.altitudeAsl",
    );
  });

  it("redirects a widget asking for the raw orbital-speed topic directly onto the derived surface, the real raw twin lives on vessel.flight, not vessel.orbit (elements-only, no orbitalSpeed field)", () => {
    expect(redirectKinematicSubtopic("vessel.flight.orbitalSpeed")).toBe(
      "vessel.state.orbitalSpeed",
    );
  });

  it("leaves non-kinematic topics, including other raw vessel.flight fields, unchanged (identity fallback)", () => {
    expect(redirectKinematicSubtopic("vessel.flight.mach")).toBe(
      "vessel.flight.mach",
    );
    expect(redirectKinematicSubtopic("vessel.flight.dynamicPressureKPa")).toBe(
      "vessel.flight.dynamicPressureKPa",
    );
    expect(redirectKinematicSubtopic("vessel.identity.name")).toBe(
      "vessel.identity.name",
    );
    expect(redirectKinematicSubtopic("some.unrelated.topic")).toBe(
      "some.unrelated.topic",
    );
    // vessel.orbit is elements-only, it never had an orbitalSpeed field, so
    // nothing should route away from it under that name either.
    expect(redirectKinematicSubtopic("vessel.orbit.orbitalSpeed")).toBe(
      "vessel.orbit.orbitalSpeed",
    );
  });
});

describe("mapTopic(sourceId, key): the surviving dynamic-namespace routing", () => {
  // Every entry left is an IDENTITY map over a namespace materialised per
  // subject at runtime, so no generated list can enumerate it and a pattern is
  // the only thing that can vouch for a key. The flat vocabulary this table used
  // to translate is gone: a name for something the wire calls otherwise has
  // nothing left to translate to.

  describe("scansat: the per-body namespaces ScansatUplink.Sample publishes", () => {
    it("identity-maps coverage, mask, height, biome and anomalies", () => {
      expect(mapTopic("data", "scansat.coverage.Kerbin.1")).toBe(
        "scansat.coverage.Kerbin.1",
      );
      expect(mapTopic("data", "scansat.mask.Kerbin.256")).toBe(
        "scansat.mask.Kerbin.256",
      );
      expect(mapTopic("data", "scansat.height.Kerbin")).toBe(
        "scansat.height.Kerbin",
      );
      expect(mapTopic("data", "scansat.biome.Kerbin")).toBe(
        "scansat.biome.Kerbin",
      );
      expect(mapTopic("data", "scansat.anomalies.Kerbin")).toBe(
        "scansat.anomalies.Kerbin",
      );
    });

    it("refuses a shape the namespace never publishes", () => {
      // coverage/mask are per (body, type-BIT), so a bare body is not one.
      expect(mapTopic("data", "scansat.coverage.Kerbin")).toBeUndefined();
    });
  });

  describe("vessel.partActions: the per-part PAW namespace", () => {
    it("identity-maps a numeric flight id", () => {
      expect(mapTopic("data", "vessel.partActions.12345")).toBe(
        "vessel.partActions.12345",
      );
    });

    it("refuses a non-numeric segment, which flightID never is", () => {
      expect(mapTopic("data", "vessel.partActions.notAnId")).toBeUndefined();
    });
  });

  describe("kos source: native + compute stream routing", () => {
    it("maps the static kos.processors push channel to itself", () => {
      expect(mapTopic("kos", "kos.processors")).toBe("kos.processors");
    });

    it("identity-maps the dynamic kos.compute.<id>.<field> namespace", () => {
      expect(mapTopic("kos", "kos.compute.foo.bar")).toBe(
        "kos.compute.foo.bar",
      );
      expect(mapTopic("kos", "kos.compute.ship-map.parts")).toBe(
        "kos.compute.ship-map.parts",
      );
    });

    it("does NOT route status sub-topics or command keys through a read", () => {
      expect(mapTopic("kos", "kos.compute.foo.status")).toBeUndefined();
      expect(mapTopic("kos", "kos.compute.foo.dispatchNow")).toBeUndefined();
      expect(mapTopic("kos", "kos.compute.foo.reEnable")).toBeUndefined();
    });

    it("returns undefined for an unrelated kos key with no stream home", () => {
      expect(mapTopic("kos", "kos.something.else")).toBeUndefined();
      expect(mapTopic("kos", "kos.compute.foo")).toBeUndefined();
    });
  });

  it("returns undefined for sources not wired to the stream", () => {
    expect(mapTopic("kerbcast", "kerbcast.cameras")).toBeUndefined();
    expect(mapTopic("unknown-source", "anything")).toBeUndefined();
  });

  it("returns undefined for a key from the retired flat vocabulary", () => {
    // These resolved once. Nothing translates them now, and a read of one gets
    // the same answer as a read of any other name nothing publishes.
    expect(mapTopic("data", "v.altitude")).toBeUndefined();
    expect(mapTopic("data", "o.ApA")).toBeUndefined();
    expect(mapTopic("data", "r.resource[ElectricCharge]")).toBeUndefined();
    expect(mapTopic("data", "not.a.real.key")).toBeUndefined();
  });
});
