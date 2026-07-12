import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  deriveVesselManeuverLegacy,
  type ManeuverNodeWirePayload,
  mapManeuverNode,
  type VesselManeuverPayload,
  vesselManeuverLegacyChannel,
} from "./maneuver-legacy";
import type { OrbitPatchWirePayload } from "./orbit-patches";
import { makeMeta } from "./stub-transport";
import type { TimelinePoint } from "./timeline";

function wirePatch(
  overrides: Partial<OrbitPatchWirePayload> = {},
): OrbitPatchWirePayload {
  return {
    sma: 300_000,
    ecc: 0.2,
    inc: 5,
    lan: 10,
    argPe: 20,
    meanAnomalyAtEpoch: 1,
    epoch: 500,
    period: 900,
    startUt: 500,
    endUt: 10_000,
    patchStartTransition: 4, // MANEUVER
    patchEndTransition: 1, // FINAL
    peA: 40_000,
    apA: 120_000,
    semiLatusRectum: 290_000,
    semiMinorAxis: 295_000,
    referenceBody: "Kerbin",
    closestEncounterBody: null,
    ...overrides,
  };
}

function wireNode(
  overrides: Partial<ManeuverNodeWirePayload> = {},
): ManeuverNodeWirePayload {
  return {
    id: "node-1",
    ut: 500,
    dvRadial: 1,
    dvNormal: 2,
    dvPrograde: 300,
    dvTotal: 300.01,
    patches: [wirePatch()],
    ...overrides,
  };
}

describe("mapManeuverNode", () => {
  it("builds the [radialOut, normal, prograde] deltaV tuple from the named fields", () => {
    const legacy = mapManeuverNode(wireNode());
    expect(legacy.deltaV).toEqual([1, 2, 300]);
    expect(legacy.UT).toBe(500);
  });

  it("defaults missing dv components to 0, not undefined/NaN", () => {
    const legacy = mapManeuverNode(
      wireNode({ dvRadial: null, dvNormal: undefined, dvPrograde: null }),
    );
    expect(legacy.deltaV).toEqual([0, 0, 0]);
  });

  it("flattens orbitPatches[0]'s fields onto the node's own headline numbers", () => {
    const patch = wirePatch();
    const legacy = mapManeuverNode(wireNode({ patches: [patch] }));
    expect(legacy.PeA).toBe(patch.peA);
    expect(legacy.ApA).toBe(patch.apA);
    expect(legacy.inclination).toBe(patch.inc);
    expect(legacy.sma).toBe(patch.sma);
    expect(legacy.referenceBody).toBe(patch.referenceBody);
    expect(legacy.orbitPatches).toHaveLength(1);
  });

  it("defaults headline numbers sanely when the post-burn patch hasn't resolved yet", () => {
    const legacy = mapManeuverNode(wireNode({ patches: [] }));
    expect(legacy.PeA).toBe(0);
    expect(legacy.ApA).toBe(0);
    expect(legacy.referenceBody).toBe("");
    expect(legacy.closestEncounterBody).toBeNull();
    expect(legacy.orbitPatches).toEqual([]);
  });
});

function pt<T>(payload: T | null): TimelinePoint<T> {
  return { payload, meta: makeMeta({ quality: Quality.OnRails }) };
}

describe("deriveVesselManeuverLegacy", () => {
  it("undefined while vessel.maneuver hasn't arrived", () => {
    const result = deriveVesselManeuverLegacy(() => undefined);
    expect(result).toBeUndefined();
  });

  it("null on a confirmed vessel.maneuver tombstone", () => {
    const result = deriveVesselManeuverLegacy(() =>
      pt<VesselManeuverPayload>(null),
    );
    expect(result).toBeNull();
  });

  it("always an array — empty when there are no queued nodes", () => {
    const result = deriveVesselManeuverLegacy(() =>
      pt<VesselManeuverPayload>({ nodes: [] }),
    );
    expect(result?.nodes).toEqual([]);
  });

  it("maps every node in order", () => {
    const nodeA = wireNode({ id: "a", ut: 100 });
    const nodeB = wireNode({ id: "b", ut: 200 });
    const result = deriveVesselManeuverLegacy(() =>
      pt<VesselManeuverPayload>({ nodes: [nodeA, nodeB] }),
    );
    expect(result?.nodes.map((n) => n.UT)).toEqual([100, 200]);
  });
});

describe("vesselManeuverLegacyChannel", () => {
  it("declares vessel.maneuver as its only input — scoped narrowly so it doesn't widen vessel.state's carried-channels requirement", () => {
    expect(vesselManeuverLegacyChannel.topic).toBe("vessel.maneuver.legacy");
    expect(vesselManeuverLegacyChannel.inputs).toEqual(["vessel.maneuver"]);
    expect(vesselManeuverLegacyChannel.fields).toBe(true);
  });
});
