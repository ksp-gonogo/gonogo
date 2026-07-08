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
  });

  it("maps the 7 derivable orbital vessel.state.* keys (M3 vessel-state-extend un-gap — M2 bridge task Fix 2's phantom entries now have a real produced field)", () => {
    expect(mapTopic("data", "v.missionTime")).toBe("vessel.state.met");
    expect(mapTopic("data", "o.ApA")).toBe("vessel.state.apoapsisAlt");
    expect(mapTopic("data", "o.PeA")).toBe("vessel.state.periapsisAlt");
    expect(mapTopic("data", "o.period")).toBe("vessel.state.period");
    expect(mapTopic("data", "o.timeToAp")).toBe("vessel.state.timeToAp");
    expect(mapTopic("data", "o.timeToPe")).toBe("vessel.state.timeToPe");
    expect(mapTopic("data", "o.trueAnomaly")).toBe("vessel.state.trueAnomaly");

    for (const key of [
      "v.missionTime",
      "o.ApA",
      "o.PeA",
      "o.period",
      "o.timeToAp",
      "o.timeToPe",
      "o.trueAnomaly",
    ]) {
      expect(isKnownTelemachusGap("data", key)).toBe(false);
    }
  });

  it("resolves the parametric b.<field>[i] family onto the one system.bodies array topic", () => {
    expect(mapTopic("data", "b.name[0]")).toBe("system.bodies");
    expect(mapTopic("data", "b.o.sma[3]")).toBe("system.bodies");
  });

  it("gaps b.number — the widget reads a scalar count, not the raw system.bodies array (M2 T7 critical fix)", () => {
    expect(mapTopic("data", "b.number")).toBeUndefined();
    expect(isKnownTelemachusGap("data", "b.number")).toBe(true);
  });

  it("resolves the parametric r.resource[X] vessel-total family onto vessel.resources's REAL wire shape (M3 batch-1 fix: the wire wraps in a 'resources' key, ToWire(VesselResources) in VesselViewProvider.cs — a flat vessel.resources.<X>.current target silently never resolves against the real payload)", () => {
    expect(mapTopic("data", "r.resource[LiquidFuel]")).toBe(
      "vessel.resources.resources.LiquidFuel.current",
    );
    expect(mapTopic("data", "r.resourceMax[ElectricCharge]")).toBe(
      "vessel.resources.resources.ElectricCharge.max",
    );
  });

  it("returns undefined for known gaps (no silent identity fallback)", () => {
    // (tar.availableVessels was un-gapped in the M3 vessel-gap batch — it now
    // maps to system.vessels; see the roster mapping test below. career.funds/
    // reputation/science were un-gapped in the M3 career batch, and
    // strategies.all/tech.nodes/contracts.active/contracts.offered/
    // kc.facilityLevels were un-gapped in the M3b career-detail batch — see
    // the career.status mapping tests below.)
    expect(mapTopic("data", "land.speedAtImpact")).toBeUndefined();
    expect(mapTopic("data", "land.timeToImpact")).toBeUndefined();
    expect(mapTopic("data", "contracts.completedRecent")).toBeUndefined();
    expect(isKnownTelemachusGap("data", "land.timeToImpact")).toBe(true);
    expect(isKnownTelemachusGap("data", "contracts.completedRecent")).toBe(
      true,
    );
  });

  it("maps the M3 career batch's economy scalars onto career.status", () => {
    expect(mapTopic("data", "career.funds")).toBe(
      "career.status.economy.funds",
    );
    expect(mapTopic("data", "career.reputation")).toBe(
      "career.status.economy.reputation",
    );
    expect(mapTopic("data", "career.science")).toBe(
      "career.status.economy.science",
    );
    expect(isKnownTelemachusGap("data", "career.funds")).toBe(false);
    expect(isKnownTelemachusGap("data", "career.reputation")).toBe(false);
    expect(isKnownTelemachusGap("data", "career.science")).toBe(false);
    // career.mode stays gapped (ScienceBench/useGameContext, out of this
    // batch's scope — no economy-group equivalent).
    expect(mapTopic("data", "career.mode")).toBeUndefined();
    expect(isKnownTelemachusGap("data", "career.mode")).toBe(true);
  });

  it("maps the M3b career-detail batch's facilities/contracts/strategies/tech reads onto career.status", () => {
    expect(mapTopic("data", "kc.facilityLevels")).toBe(
      "career.status.facilities",
    );
    expect(mapTopic("data", "contracts.active")).toBe(
      "career.status.contracts.active",
    );
    expect(mapTopic("data", "contracts.offered")).toBe(
      "career.status.contracts.offered",
    );
    expect(mapTopic("data", "strategies.all")).toBe(
      "career.status.strategies.all",
    );
    expect(mapTopic("data", "tech.nodes")).toBe("career.status.tech.nodes");
    expect(isKnownTelemachusGap("data", "kc.facilityLevels")).toBe(false);
    expect(isKnownTelemachusGap("data", "contracts.active")).toBe(false);
    expect(isKnownTelemachusGap("data", "contracts.offered")).toBe(false);
    expect(isKnownTelemachusGap("data", "strategies.all")).toBe(false);
    expect(isKnownTelemachusGap("data", "tech.nodes")).toBe(false);
    // contracts.completedRecent stays gapped — no wire equivalent
    // (CareerViewProvider only ever emits active/offered).
    expect(mapTopic("data", "contracts.completedRecent")).toBeUndefined();
    expect(isKnownTelemachusGap("data", "contracts.completedRecent")).toBe(
      true,
    );
  });

  it("maps the M3 vessel-gap batch's newly-added roster / dock / node-id keys", () => {
    // tar.availableVessels roster -> system.vessels (2-segment whole topic).
    expect(mapTopic("data", "tar.availableVessels")).toBe("system.vessels");
    expect(isKnownTelemachusGap("data", "tar.availableVessels")).toBe(false);
    // The raw Vec3 reads DistanceToTarget derives its scalars/angles from.
    expect(mapTopic("data", "tar.relativePosition")).toBe(
      "vessel.target.relativePosition",
    );
    expect(mapTopic("data", "dock.relativePosition")).toBe(
      "vessel.dock.relativePosition",
    );
    expect(mapTopic("data", "dock.forwardDot")).toBe("vessel.dock.forwardDot");
    // ManeuverPlanner's node-id read for the update/remove command bridge.
    expect(mapTopic("data", "o.maneuverNodeIds")).toBe("vessel.maneuver.nodes");
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

  it("returns undefined for sources still not wired to the new SDK (kerbcast, unknown)", () => {
    expect(mapTopic("kerbcast", "kerbcast.cameras")).toBeUndefined();
    expect(mapTopic("unknown-source", "anything")).toBeUndefined();
    expect(isKnownTelemachusGap("kos", "kos.compute.ship-map.parts")).toBe(
      false,
    );
  });

  describe("kos source (U3 kOS slice) — native + compute stream routing", () => {
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
      expect(mapTopic("kos", "kos.compute.kos-processors.processors")).toBe(
        "kos.compute.kos-processors.processors",
      );
    });

    it("does NOT route status sub-topics or command keys through useDataValue", () => {
      expect(mapTopic("kos", "kos.compute.foo.status")).toBeUndefined();
      expect(mapTopic("kos", "kos.compute.foo.dispatchNow")).toBeUndefined();
      expect(mapTopic("kos", "kos.compute.foo.reEnable")).toBeUndefined();
    });

    it("returns undefined for an unrelated kos key with no stream home", () => {
      expect(mapTopic("kos", "kos.something.else")).toBeUndefined();
      expect(mapTopic("kos", "kos.compute.foo")).toBeUndefined();
    });
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
