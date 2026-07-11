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

  it("maps v.body / o.referenceBody onto the derived body-NAME display-map subtopics (Step-2 migration task 1 un-gap)", () => {
    expect(mapTopic("data", "v.body")).toBe("vessel.state.parentBodyName");
    expect(mapTopic("data", "o.referenceBody")).toBe(
      "vessel.state.referenceBodyName",
    );
    expect(isKnownTelemachusGap("data", "v.body")).toBe(false);
    expect(isKnownTelemachusGap("data", "o.referenceBody")).toBe(false);
  });

  it("maps the enum-ordinal→name keys onto their derived vessel.state.* subtopics (enum-ordinal→string-name migration un-gap)", () => {
    expect(mapTopic("data", "v.situationString")).toBe(
      "vessel.state.situationName",
    );
    expect(mapTopic("data", "f.sasMode")).toBe("vessel.state.sasModeName");
    expect(mapTopic("data", "tar.type")).toBe("vessel.state.targetKind");
    expect(mapTopic("data", "comm.controlStateName")).toBe(
      "vessel.state.commsControlStateName",
    );
    expect(mapTopic("data", "comm.controlState")).toBe(
      "vessel.state.commsControlStateOrdinal",
    );
    for (const key of [
      "v.situationString",
      "f.sasMode",
      "tar.type",
      "comm.controlStateName",
      "comm.controlState",
    ]) {
      expect(isKnownTelemachusGap("data", key)).toBe(false);
    }
  });

  it("maps v.biome / v.landedAt onto vessel.surface fields (R6 prep un-gap: vessel.surface capture-add)", () => {
    expect(mapTopic("data", "v.biome")).toBe("vessel.surface.biome");
    expect(mapTopic("data", "v.landedAt")).toBe("vessel.surface.landedAt");
    expect(isKnownTelemachusGap("data", "v.biome")).toBe(false);
    expect(isKnownTelemachusGap("data", "v.landedAt")).toBe(false);
  });

  it("maps comm.signalDelay onto comms.delay.oneWaySeconds (Step-3 un-gap: gonogo's live SignalDelay authority)", () => {
    expect(mapTopic("data", "comm.signalDelay")).toBe(
      "comms.delay.oneWaySeconds",
    );
    expect(isKnownTelemachusGap("data", "comm.signalDelay")).toBe(false);
  });

  it("resolves the parametric b.<field>[i] family onto the one system.bodies array topic", () => {
    expect(mapTopic("data", "b.name[0]")).toBe("system.bodies");
    expect(mapTopic("data", "b.o.sma[3]")).toBe("system.bodies");
  });

  it("maps b.number onto the derived system.state.bodyCount (batch-2 migration — the plain COUNT off the raw system.bodies array)", () => {
    expect(mapTopic("data", "b.number")).toBe("system.state.bodyCount");
    expect(isKnownTelemachusGap("data", "b.number")).toBe(false);
  });

  it("maps the batch-2 shape-mismatch migrations (encounter scalars, target range-rate, dock offsets)", () => {
    expect(mapTopic("data", "o.encounterExists")).toBe(
      "vessel.state.encounterExists",
    );
    expect(mapTopic("data", "o.encounterBody")).toBe(
      "vessel.state.encounterBody",
    );
    expect(mapTopic("data", "o.encounterTime")).toBe(
      "vessel.state.encounterTime",
    );
    expect(mapTopic("data", "tar.o.relativeVelocity")).toBe(
      "vessel.state.targetRelativeSpeed",
    );
    // dock.x/dock.y walk into the vessel.dock.relativePosition Vec3 via the
    // raw-field-subtopic mechanism.
    expect(mapTopic("data", "dock.x")).toBe("vessel.dock.relativePosition.x");
    expect(mapTopic("data", "dock.y")).toBe("vessel.dock.relativePosition.y");
    for (const key of [
      "o.encounterExists",
      "o.encounterBody",
      "o.encounterTime",
      "tar.o.relativeVelocity",
      "dock.x",
      "dock.y",
    ]) {
      expect(isKnownTelemachusGap("data", key)).toBe(false);
    }
  });

  it("maps the A-tranche derived-quantity migrations onto their vessel.state.* subtopics (o.ApR/o.PeR/o.radius/nextApsis/horizontalVelocity/tar.distance/tar.o.*)", () => {
    expect(mapTopic("data", "o.ApR")).toBe("vessel.state.apoapsisRadius");
    expect(mapTopic("data", "o.PeR")).toBe("vessel.state.periapsisRadius");
    expect(mapTopic("data", "o.radius")).toBe("vessel.state.orbitalRadius");
    expect(mapTopic("data", "o.nextApsisType")).toBe(
      "vessel.state.nextApsisType",
    );
    expect(mapTopic("data", "o.timeToNextApsis")).toBe(
      "vessel.state.timeToNextApsis",
    );
    expect(mapTopic("data", "v.horizontalVelocity")).toBe(
      "vessel.state.horizontalSpeed",
    );
    expect(mapTopic("data", "tar.distance")).toBe(
      "vessel.state.targetDistance",
    );
    expect(mapTopic("data", "tar.o.PeA")).toBe(
      "vessel.state.targetPeriapsisAlt",
    );
    expect(mapTopic("data", "tar.o.period")).toBe("vessel.state.targetPeriod");
    expect(mapTopic("data", "tar.o.trueAnomaly")).toBe(
      "vessel.state.targetTrueAnomaly",
    );
    for (const key of [
      "o.ApR",
      "o.PeR",
      "o.radius",
      "o.nextApsisType",
      "o.timeToNextApsis",
      "v.horizontalVelocity",
      "tar.distance",
      "tar.o.PeA",
      "tar.o.period",
      "tar.o.trueAnomaly",
    ]) {
      expect(isKnownTelemachusGap("data", key)).toBe(false);
    }
  });

  it("leaves the genuinely-underivable v.angleToPrograde gapped (needs a facing vector + defined prograde frame, neither on the wire)", () => {
    expect(mapTopic("data", "v.angleToPrograde")).toBeUndefined();
    expect(isKnownTelemachusGap("data", "v.angleToPrograde")).toBe(true);
  });

  it("maps the R6 shared-derivations batch (twr, controllable/EVA/splashed flags, action groups, closest approach) onto vessel.state.*", () => {
    expect(mapTopic("data", "dv.currentTWR")).toBe("vessel.state.twr");
    expect(mapTopic("data", "v.isControllable")).toBe(
      "vessel.state.isControllable",
    );
    expect(mapTopic("data", "v.isEVA")).toBe("vessel.state.isEVA");
    expect(mapTopic("data", "v.splashed")).toBe("vessel.state.isSplashed");
    expect(mapTopic("data", "v.ag1Value")).toBe("vessel.state.actionGroup1");
    expect(mapTopic("data", "v.ag10Value")).toBe("vessel.state.actionGroup10");
    expect(mapTopic("data", "o.closestTgtApprUT")).toBe(
      "vessel.state.closestApproachUt",
    );
    for (const key of [
      "dv.currentTWR",
      "v.isControllable",
      "v.isEVA",
      "v.splashed",
      "v.ag1Value",
      "v.ag10Value",
      "o.closestTgtApprUT",
    ]) {
      expect(isKnownTelemachusGap("data", key)).toBe(false);
    }
  });

  it("leaves the true docking-orientation axes (dock.ax/ay/az) gapped until the DistanceToTarget migrate-widget task drops them (HUD proxy is the shared prerequisite)", () => {
    // Not on the wire; the shared deriveDockAngles HUD proxy replaces them, but
    // the widget still reads them legacy-only until its migration reworks the
    // fixtures/snapshots — so they stay tracked gaps for now.
    for (const key of ["dock.ax", "dock.ay", "dock.az"]) {
      expect(mapTopic("data", key)).toBeUndefined();
      expect(isKnownTelemachusGap("data", key)).toBe(true);
    }
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
    // the career.status mapping tests below. contracts.completedRecent was
    // un-gapped in the P4a shared-map batch — see the dedicated test below.
    // The four ballistic land.* scalars were un-gapped as client-derived
    // vessel.state.landing* — see the dedicated test below; the three
    // terrain/trajectory land.* fields below stay gapped.)
    expect(mapTopic("data", "land.predictedLat")).toBeUndefined();
    expect(mapTopic("data", "land.predictedLon")).toBeUndefined();
    expect(mapTopic("data", "land.slopeAngle")).toBeUndefined();
    expect(isKnownTelemachusGap("data", "land.slopeAngle")).toBe(true);
  });

  it("maps the four ballistic land.* scalars onto vessel.state.landing*", () => {
    expect(mapTopic("data", "land.timeToImpact")).toBe(
      "vessel.state.landingTimeToImpact",
    );
    expect(mapTopic("data", "land.speedAtImpact")).toBe(
      "vessel.state.landingSpeedAtImpact",
    );
    expect(mapTopic("data", "land.bestSpeedAtImpact")).toBe(
      "vessel.state.landingBestSpeedAtImpact",
    );
    expect(mapTopic("data", "land.suicideBurnCountdown")).toBe(
      "vessel.state.landingSuicideBurnCountdown",
    );
    expect(isKnownTelemachusGap("data", "land.timeToImpact")).toBe(false);
    expect(isKnownTelemachusGap("data", "land.speedAtImpact")).toBe(false);
    expect(isKnownTelemachusGap("data", "land.bestSpeedAtImpact")).toBe(false);
    expect(isKnownTelemachusGap("data", "land.suicideBurnCountdown")).toBe(
      false,
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
  });

  it("maps career.mode onto its own raw wire topic's mode field (P4a D1)", () => {
    expect(mapTopic("data", "career.mode")).toBe("career.mode.mode");
    expect(isKnownTelemachusGap("data", "career.mode")).toBe(false);
  });

  it("maps science.sensors as a whole-topic identity read (P4a D2)", () => {
    expect(mapTopic("data", "science.sensors")).toBe("science.sensors");
    expect(isKnownTelemachusGap("data", "science.sensors")).toBe(false);
    // The four per-type reads stay gapped — no per-type field on the wire.
    expect(mapTopic("data", "s.sensor.temp")).toBeUndefined();
    expect(isKnownTelemachusGap("data", "s.sensor.temp")).toBe(true);
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
    // contracts.completedRecent UN-GAPPED (P4a shared-map batch): a
    // completedRecent list now ships alongside active/offered.
    expect(mapTopic("data", "contracts.completedRecent")).toBe(
      "career.status.contracts.completedRecent",
    );
    expect(isKnownTelemachusGap("data", "contracts.completedRecent")).toBe(
      false,
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
        // v.body / o.referenceBody were here until Step-2 migration task 1 —
        // now that a client-side index→name display-map subtopic exists
        // (vessel.state.parentBodyName / referenceBodyName), they map cleanly;
        // see the dedicated body-name test below.
        // b.number / o.encounter* / dock.x / dock.y / tar.o.relativeVelocity
        // were here until the batch-2 shape-mismatch migration — now that
        // client-side derived subtopics exist (system.state.bodyCount,
        // vessel.state.encounter*, vessel.state.targetRelativeSpeed) and
        // dock.x/y walk into vessel.dock.relativePosition, they map cleanly;
        // see the dedicated batch-2 test above.
        // comm.controlState / comm.controlStateName + v.situationString /
        // f.sasMode / tar.type were here until the enum-ordinal→name migration;
        // now that client-side ordinal→string/level display-map subtopics
        // exist (vessel.state.commsControlStateOrdinal / commsControlStateName /
        // situationName / sasModeName / targetKind), they map cleanly — see the
        // dedicated enum-ordinal→name test above.
        "o.maneuverNodes", // deltaV tuple + orbit-preview fields not on the wire
        // dv.currentTWR moved to CLEAN_HOMES (R6): derived on vessel.state.twr
        // off vessel.propulsion — see the R6 shared-derivations test above.
        // comm.signalDelay moved to CLEAN_HOMES (Step-3): comms.delay is live
        // on the wire — see the dedicated comm.signalDelay test above.
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

    it("maps v.abortValue onto vessel.control.abort (P4a command batch)", () => {
      expect(mapTopic("data", "v.abortValue")).toBe("vessel.control.abort");
      expect(isKnownTelemachusGap("data", "v.abortValue")).toBe(false);
    });

    it("maps v.precisionControlValue onto vessel.control.precisionControl (P4a shared-map batch)", () => {
      expect(mapTopic("data", "v.precisionControlValue")).toBe(
        "vessel.control.precisionControl",
      );
      expect(isKnownTelemachusGap("data", "v.precisionControlValue")).toBe(
        false,
      );
    });
  });

  describe("P4a shared-map batch — remaining trivial raw-field walks + whole-topic reads", () => {
    it("maps f.precisionControl onto the same vessel.control field as v.precisionControlValue", () => {
      expect(mapTopic("data", "f.precisionControl")).toBe(
        "vessel.control.precisionControl",
      );
      expect(isKnownTelemachusGap("data", "f.precisionControl")).toBe(false);
    });

    it("maps the not-captured VesselFlight temperatures (G-11)", () => {
      expect(mapTopic("data", "v.atmosphericTemperature")).toBe(
        "vessel.flight.atmosphericTemperature",
      );
      expect(mapTopic("data", "v.externalTemperature")).toBe(
        "vessel.flight.externalTemperature",
      );
      for (const key of ["v.atmosphericTemperature", "v.externalTemperature"]) {
        expect(isKnownTelemachusGap("data", key)).toBe(false);
      }
    });

    it("maps the crew roster + capacity (G-13)", () => {
      expect(mapTopic("data", "v.crew")).toBe("vessel.crew.crew");
      expect(mapTopic("data", "v.crewCapacity")).toBe("vessel.crew.capacity");
      expect(isKnownTelemachusGap("data", "v.crew")).toBe(false);
      expect(isKnownTelemachusGap("data", "v.crewCapacity")).toBe(false);
    });

    it("maps deployed.available onto the DLC-presence boolean (state-map correction: it IS derivable)", () => {
      expect(mapTopic("data", "deployed.available")).toBe(
        "game.dlc.breakingGround",
      );
      expect(isKnownTelemachusGap("data", "deployed.available")).toBe(false);
    });

    it("maps robotics.available onto its own capability topic", () => {
      expect(mapTopic("data", "robotics.available")).toBe(
        "robotics.available.available",
      );
      expect(isKnownTelemachusGap("data", "robotics.available")).toBe(false);
      // The identity lists stay gapped — no stable id on the wire.
      expect(mapTopic("data", "robotics.rotors")).toBeUndefined();
      expect(mapTopic("data", "robotics.servos")).toBeUndefined();
    });

    it("maps ksp.canRevertToEditor/canRevertToLaunch onto the RevertAvailability topic", () => {
      expect(mapTopic("data", "ksp.canRevertToEditor")).toBe(
        "ksp.revertAvailability.canRevertToEditor",
      );
      expect(mapTopic("data", "ksp.canRevertToLaunch")).toBe(
        "ksp.revertAvailability.canRevertToLaunch",
      );
      for (const key of ["ksp.canRevertToEditor", "ksp.canRevertToLaunch"]) {
        expect(isKnownTelemachusGap("data", key)).toBe(false);
      }
    });

    it("maps kc.scene onto its own scene topic", () => {
      expect(mapTopic("data", "kc.scene")).toBe("spaceCenter.scene.scene");
      expect(isKnownTelemachusGap("data", "kc.scene")).toBe(false);
    });

    it("maps sci.instruments onto its own per-instrument list topic (distinct from science.lab)", () => {
      expect(mapTopic("data", "sci.instruments")).toBe("science.instruments");
      expect(isKnownTelemachusGap("data", "sci.instruments")).toBe(false);
    });

    it("maps dv.stages as a whole-topic read and the summary scalars onto dv.summary", () => {
      expect(mapTopic("data", "dv.stages")).toBe("dv.stages");
      expect(mapTopic("data", "dv.stageCount")).toBe("dv.summary.stageCount");
      expect(mapTopic("data", "dv.totalDVVac")).toBe("dv.summary.totalDvVac");
      expect(mapTopic("data", "dv.totalDVASL")).toBe("dv.summary.totalDvAsl");
      expect(mapTopic("data", "dv.totalDVActual")).toBe(
        "dv.summary.totalDvActual",
      );
      expect(mapTopic("data", "dv.totalBurnTime")).toBe(
        "dv.summary.totalBurnTime",
      );
      for (const key of [
        "dv.stages",
        "dv.stageCount",
        "dv.totalDVVac",
        "dv.totalDVASL",
        "dv.totalDVActual",
        "dv.totalBurnTime",
      ]) {
        expect(isKnownTelemachusGap("data", key)).toBe(false);
      }
    });
  });
});
