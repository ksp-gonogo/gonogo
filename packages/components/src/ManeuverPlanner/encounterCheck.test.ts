import { type OrbitPatch, TransitionType, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { checkEncounter } from "./encounterCheck";

function patch(over: Partial<OrbitPatch>): OrbitPatch {
  return {
    sma: value("m", 700_000),
    ecc: value("1", 0.7),
    inc: value("°", 0),
    epoch: value("ut", 0),
    startUt: value("ut", 0),
    endUt: value("ut", 1000),
    patchStartTransition: TransitionType.Maneuver,
    patchEndTransition: TransitionType.Final,
    peA: value("m", 100_000),
    semiLatusRectum: value("m", 1),
    semiMinorAxis: value("m", 1),
    referenceBody: "Kerbin",
    ...over,
  } as OrbitPatch;
}

describe("checkEncounter", () => {
  it("is pending while the node has no patches, which says nothing about an encounter", () => {
    expect(checkEncounter([], "Mun")).toEqual({ kind: "pending" });
  });

  it("is none once patches arrived and never enter the target", () => {
    expect(checkEncounter([patch({})], "Mun")).toEqual({ kind: "none" });
  });

  it("reads the target and the periapsis altitude off the patch that enters its sphere", () => {
    const entered = patch({
      referenceBody: "Mun",
      patchStartTransition: TransitionType.Encounter,
      peA: value("m", 181_000),
    });
    expect(checkEncounter([patch({}), entered], "Mun")).toEqual({
      kind: "encounter",
      body: "Mun",
      periapsisAltitude: value("m", 181_000),
    });
  });

  it("does not take an encounter with another body for the target", () => {
    const minmus = patch({
      referenceBody: "Minmus",
      patchStartTransition: TransitionType.Encounter,
    });
    expect(checkEncounter([minmus], "Mun")).toEqual({ kind: "none" });
  });
});
