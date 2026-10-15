import { type CatalogEntry, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { recordedFlownCraft } from "./recordedFlownCraft";

const KERBIN_MU = 3.5316e12;

function entry(placeAsOfUt: number | null): CatalogEntry {
  return {
    vesselId: "v-active",
    name: "Active Craft",
    vesselType: 0,
    situation: 3,
    bodyIndex: 1,
    placeAsOfUt: placeAsOfUt === null ? null : value("ut", placeAsOfUt),
    orbit: {
      sma: value("m", 3_000_000),
      ecc: value("1", 0),
      inc: value("°", 0),
      lan: value("°", 0),
      argPe: value("°", 0),
      meanAnomalyAtEpoch: value("rad", 0),
      epoch: value("ut", 0),
    },
  };
}

const lookups = {
  nameOf: (index: number) => (index === 1 ? "Kerbin" : undefined),
  muOf: (name: string) => (name === "Kerbin" ? KERBIN_MU : null),
};

describe("recordedFlownCraft", () => {
  it("draws the craft from the record when its place there is newer than the report", () => {
    const craft = recordedFlownCraft({
      entry: entry(500),
      reportEpoch: value("ut", 100),
      ut: 600,
      ...lookups,
    });
    expect(craft).toMatchObject({ parentName: "Kerbin", sma: 3_000_000 });
    expect(craft?.trueAnomaly).toBeGreaterThan(0);
  });

  it("leaves the craft to its report when the record is no newer", () => {
    expect(
      recordedFlownCraft({
        entry: entry(100),
        reportEpoch: value("ut", 100),
        ut: 600,
        ...lookups,
      }),
    ).toBeNull();
    expect(
      recordedFlownCraft({
        entry: entry(50),
        reportEpoch: value("ut", 100),
        ut: 600,
        ...lookups,
      }),
    ).toBeNull();
  });

  it("draws from the record when no report has arrived", () => {
    expect(
      recordedFlownCraft({
        entry: entry(500),
        reportEpoch: undefined,
        ut: 600,
        ...lookups,
      }),
    ).not.toBeNull();
  });

  it("draws nothing from a record with no place time, no body or no gravitational parameter", () => {
    expect(
      recordedFlownCraft({
        entry: entry(null),
        reportEpoch: value("ut", 100),
        ut: 600,
        ...lookups,
      }),
    ).toBeNull();
    expect(
      recordedFlownCraft({
        entry: { ...entry(500), bodyIndex: 7 },
        reportEpoch: value("ut", 100),
        ut: 600,
        ...lookups,
      }),
    ).toBeNull();
    expect(
      recordedFlownCraft({
        entry: entry(500),
        reportEpoch: value("ut", 100),
        ut: 600,
        nameOf: lookups.nameOf,
        muOf: () => null,
      }),
    ).toBeNull();
  });
});
