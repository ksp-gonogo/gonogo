import { describe, expect, it } from "vitest";
import {
  isKnownTelemachusGap,
  mapTopic,
  redirectKinematicSubtopic,
  TELEMACHUS_KNOWN_GAPS,
} from "./map-topic";

describe("redirectKinematicSubtopic (T3 — new-SDK topic safety net)", () => {
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

  it("redirects a widget asking for the raw orbital-speed topic directly onto the derived surface — the real raw twin lives on vessel.flight, not vessel.orbit (elements-only, no orbitalSpeed field)", () => {
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
    // vessel.orbit is elements-only — it never had an orbitalSpeed field, so
    // nothing should route away from it under that name either.
    expect(redirectKinematicSubtopic("vessel.orbit.orbitalSpeed")).toBe(
      "vessel.orbit.orbitalSpeed",
    );
  });
});

describe("mapTopic(sourceId, key) — the M3 useDataValue migration table", () => {
  it("maps clean-home Telemachus keys to their new stream topic", () => {
    expect(mapTopic("data", "v.altitude")).toBe("vessel.state.altitudeAsl");
    expect(mapTopic("data", "o.orbitalSpeed")).toBe(
      "vessel.state.orbitalSpeed",
    );
    expect(mapTopic("data", "o.sma")).toBe("vessel.orbit.sma");
    expect(mapTopic("data", "v.lat")).toBe("vessel.flight.latitude");
    expect(mapTopic("data", "comm.connected")).toBe("vessel.comms.connected");
    expect(mapTopic("data", "t.currentRate")).toBe("time.warp.warpRate");
  });

  it("kinematics (position/velocity/altitude/orbitalSpeed family) land on vessel.state.* — V-12", () => {
    expect(mapTopic("data", "v.altitude")).toMatch(/^vessel\.state\./);
    expect(mapTopic("data", "v.orbitalVelocity")).toMatch(/^vessel\.state\./);
    expect(mapTopic("data", "o.orbitalSpeed")).toMatch(/^vessel\.state\./);
    expect(mapTopic("data", "v.missionTime")).toBe("vessel.state.met");
  });

  it("resolves the parametric b.<field>[i] family onto the one system.bodies array topic", () => {
    expect(mapTopic("data", "b.name[0]")).toBe("system.bodies");
    expect(mapTopic("data", "b.o.sma[3]")).toBe("system.bodies");
  });

  it("gaps b.number — the widget reads a scalar count, not the raw system.bodies array (M2 T7 critical fix)", () => {
    expect(mapTopic("data", "b.number")).toBeUndefined();
    expect(isKnownTelemachusGap("data", "b.number")).toBe(true);
  });

  it("resolves the parametric r.resource[X] vessel-total family onto vessel.resources.<X>.{current,max}", () => {
    expect(mapTopic("data", "r.resource[LiquidFuel]")).toBe(
      "vessel.resources.LiquidFuel.current",
    );
    expect(mapTopic("data", "r.resourceMax[ElectricCharge]")).toBe(
      "vessel.resources.ElectricCharge.max",
    );
  });

  it("returns undefined for known gaps (no silent identity fallback)", () => {
    expect(mapTopic("data", "tar.availableVessels")).toBeUndefined();
    expect(mapTopic("data", "land.timeToImpact")).toBeUndefined();
    expect(mapTopic("data", "career.funds")).toBeUndefined();
    expect(isKnownTelemachusGap("data", "tar.availableVessels")).toBe(true);
    expect(isKnownTelemachusGap("data", "career.funds")).toBe(true);
  });

  it("treats stage-scoped resource keys and derived per-body rotation as gaps, not clean homes", () => {
    expect(mapTopic("data", "r.resourceCurrent[LiquidFuel]")).toBeUndefined();
    expect(mapTopic("data", "b.rotationAngle[0]")).toBeUndefined();
    expect(mapTopic("data", "b.rotates[0]")).toBeUndefined();
    expect(isKnownTelemachusGap("data", "r.resourceCurrent[LiquidFuel]")).toBe(
      true,
    );
    expect(isKnownTelemachusGap("data", "b.rotationAngle[0]")).toBe(true);
  });

  it("returns undefined for sources other than the Telemachus 'data' source — not wired to the new SDK in M2", () => {
    expect(mapTopic("kos", "kos.compute.ship-map.parts")).toBeUndefined();
    expect(mapTopic("kerbcast", "kerbcast.cameras")).toBeUndefined();
    expect(isKnownTelemachusGap("kos", "kos.compute.ship-map.parts")).toBe(
      false,
    );
  });

  it("returns undefined for a totally unrecognized 'data' key rather than pretending it's mapped", () => {
    expect(mapTopic("data", "not.a.real.telemachus.key")).toBeUndefined();
    expect(isKnownTelemachusGap("data", "not.a.real.telemachus.key")).toBe(
      false,
    );
  });

  it("TELEMACHUS_KNOWN_GAPS and TELEMACHUS_CLEAN_HOMES never claim the same key", () => {
    for (const gapKey of TELEMACHUS_KNOWN_GAPS) {
      expect(mapTopic("data", gapKey)).toBeUndefined();
    }
  });

  describe("CRITICAL fix (M2 T7 review): shape-mismatched entries are gapped, not silently corrupting", () => {
    it("gaps every entry that used to collapse a scalar/string old key onto a composite/array/vector new topic", () => {
      const shapeMismatchedKeys = [
        "v.body", // string body name vs int parentBodyIndex
        "o.referenceBody", // string body name vs int referenceBodyIndex
        "b.number", // number count vs the raw system.bodies array
        "o.encounterExists", // number vs the vessel.orbit.encounter record
        "o.encounterBody", // string vs the vessel.orbit.encounter record
        "o.encounterTime", // number vs the vessel.orbit.encounter record
        "dock.x", // scalar vs vessel.target.relativePosition (Vec3)
        "dock.y", // scalar vs vessel.target.relativePosition (Vec3)
        "comm.controlState", // number vs the vessel.comms.controlState string enum
        "comm.controlStateName", // string vs the vessel.comms.controlState string enum
        "tar.o.relativeVelocity", // scalar vs vessel.target.relativeVelocity (Vec3)
        "o.maneuverNodes", // deltaV tuple + orbit-preview fields not on the wire
        "dv.currentTWR", // no twr field on vessel.propulsion at all
        "comm.signalDelay", // comms.delay has no implementation anywhere yet
      ];

      for (const key of shapeMismatchedKeys) {
        expect(mapTopic("data", key)).toBeUndefined();
        expect(isKnownTelemachusGap("data", key)).toBe(true);
      }
    });
  });

  describe("ActionGroup's dynamically-resolved keys (M2 T7 fix, part 2)", () => {
    it("maps the boolean action-group keys with a real 1:1 field on VesselControl", () => {
      expect(mapTopic("data", "v.sasValue")).toBe("vessel.control.sas");
      expect(mapTopic("data", "v.rcsValue")).toBe("vessel.control.rcs");
      expect(mapTopic("data", "v.gearValue")).toBe("vessel.control.gear");
      expect(mapTopic("data", "v.brakeValue")).toBe("vessel.control.brakes");
      expect(mapTopic("data", "v.lightValue")).toBe("vessel.control.lights");
    });

    it("gaps the action-group keys with no individual field on VesselControl", () => {
      const noIndividualField = [
        "v.abortValue",
        "v.precisionControlValue",
        "v.ag1Value",
        "v.ag2Value",
        "v.ag3Value",
        "v.ag4Value",
        "v.ag5Value",
        "v.ag6Value",
        "v.ag7Value",
        "v.ag8Value",
        "v.ag9Value",
        "v.ag10Value",
      ];
      for (const key of noIndividualField) {
        expect(mapTopic("data", key)).toBeUndefined();
        expect(isKnownTelemachusGap("data", key)).toBe(true);
      }
    });
  });
});
