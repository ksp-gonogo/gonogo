// Imported for the module-load side effect as much as for the value: this is what registers `spaceCenter.state`'s hand-declared field metadata.
import { spaceCenterStateChannel } from "@ksp-gonogo/sitrep-sdk/spine";
import { describe, expect, it } from "vitest";
import { isKnownFieldPath, mapTopic } from "./map-topic";

describe("isKnownFieldPath", () => {
  it("resolves a contract field that no legacy key ever named", () => {
    // The half the migration table cannot carry. `activationPatched` is a
    // field the wire gained after the migration began, so it has no legacy
    // predecessor to be the new home of, and a widget declaring it had nothing
    // to validate against.
    expect(isKnownFieldPath("career.status.strategies.activationPatched")).toBe(
      true,
    );
    expect(isKnownFieldPath("career.status.balances")).toBe(true);
    expect(isKnownFieldPath("career.status.balances.science")).toBe(true);
  });

  it("still resolves a derived-channel field, which no contract type declares", () => {
    void spaceCenterStateChannel;
    expect(isKnownFieldPath("spaceCenter.state.padOccupied")).toBe(true);
  });

  it("rejects a plausible name the contract does not declare", () => {
    // The positive control. A walk that returned true here would make every
    // declaration gate downstream of it vacuous.
    expect(isKnownFieldPath("career.status.balances.notAField")).toBe(false);
    expect(isKnownFieldPath("career.status.balances.funds.notAField")).toBe(
      false,
    );
    expect(isKnownFieldPath("spaceCenter.state.notAField")).toBe(false);
    expect(isKnownFieldPath("notATopic.atAll")).toBe(false);
  });

  it("stops at a collection rather than guessing past its key", () => {
    // `facilities` is a dynamic-key map, so what follows it is a facility name
    // the contract never lists. The collection itself is a real field; a path
    // through it cannot be judged, and guessing is worse than declining.
    expect(isKnownFieldPath("career.facilities.facilities")).toBe(true);
    expect(
      isKnownFieldPath("career.facilities.facilities.LaunchPad.maxTier"),
    ).toBe(false);
  });
});

describe("mapTopic(key): the surviving dynamic-namespace routing", () => {
  // Every entry left is an IDENTITY map over a namespace materialised per
  // subject at runtime, so no generated list can enumerate it and a pattern is
  // the only thing that can vouch for a key. The flat vocabulary this table used
  // to translate is gone: a name for something the wire calls otherwise has
  // nothing left to translate to.

  describe("scansat: the per-body namespaces ScansatUplink.Sample publishes", () => {
    it("identity-maps coverage, mask, height, biome and anomalies", () => {
      expect(mapTopic("scansat.coverage.Kerbin.1")).toBe(
        "scansat.coverage.Kerbin.1",
      );
      expect(mapTopic("scansat.mask.Kerbin.256")).toBe(
        "scansat.mask.Kerbin.256",
      );
      expect(mapTopic("scansat.height.Kerbin")).toBe("scansat.height.Kerbin");
      expect(mapTopic("scansat.biome.Kerbin")).toBe("scansat.biome.Kerbin");
      expect(mapTopic("scansat.anomalies.Kerbin")).toBe(
        "scansat.anomalies.Kerbin",
      );
    });

    it("refuses a shape the namespace never publishes", () => {
      // coverage/mask are per (body, type-BIT), so a bare body is not one.
      expect(mapTopic("scansat.coverage.Kerbin")).toBeUndefined();
    });
  });

  describe("vessel.partActions: the per-part PAW namespace", () => {
    it("identity-maps a numeric flight id", () => {
      expect(mapTopic("vessel.partActions.12345")).toBe(
        "vessel.partActions.12345",
      );
    });

    it("refuses a non-numeric segment, which flightID never is", () => {
      expect(mapTopic("vessel.partActions.notAnId")).toBeUndefined();
    });
  });

  it("returns undefined for a key from the retired flat vocabulary", () => {
    // These resolved once. Nothing translates them now, and a read of one gets
    // the same answer as a read of any other name nothing publishes.
    expect(mapTopic("v.altitude")).toBeUndefined();
    expect(mapTopic("o.ApA")).toBeUndefined();
    expect(mapTopic("r.resource[ElectricCharge]")).toBeUndefined();
    expect(mapTopic("not.a.real.key")).toBeUndefined();
  });
});
