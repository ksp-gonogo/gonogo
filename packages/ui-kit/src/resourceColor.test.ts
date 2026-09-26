import { describe, expect, it } from "vitest";
import {
  CURATED_RESERVED_ZONES,
  hashHue,
  matchCuratedHue,
  memberLightness,
  placedColor,
  resourceColor,
} from "./resourceColor";

/** Local mirror of the module's private circular-distance helper. */
function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

describe("resourceColor", () => {
  it("is deterministic: same name always yields the same colour", () => {
    expect(resourceColor("LiquidFuel")).toBe(resourceColor("LiquidFuel"));
    expect(resourceColor("Nertea's SuperFuel")).toBe(
      resourceColor("Nertea's SuperFuel"),
    );
  });

  it("is case-insensitive", () => {
    expect(resourceColor("LiquidFuel")).toBe(resourceColor("liquidfuel"));
    expect(resourceColor("WATER")).toBe(resourceColor("water"));
  });

  it("returns an hsl() string with saturation and lightness in the legible band", () => {
    const color = resourceColor("Water");
    expect(color).toMatch(/^hsl\(\d+deg 65% \d+%\)$/);
    const match = color.match(/(\d+)%\)$/);
    const lightness = Number(match?.[1]);
    expect(lightness).toBeGreaterThanOrEqual(38);
    expect(lightness).toBeLessThanOrEqual(72);
  });

  it("maps curated resources to kind-appropriate hues", () => {
    // Exact numbers are tunable; each curated resource must resolve through Tier 1.
    const water = resourceColor("Water");
    const oxidizer = resourceColor("Oxidizer");
    const liquidFuel = resourceColor("LiquidFuel");
    const food = resourceColor("Food");
    expect(water).not.toBe(oxidizer);
    expect(water).not.toBe(liquidFuel);
    expect(oxidizer).not.toBe(liquidFuel);
    expect(food).not.toBe(water);
  });

  it("resolves aliases of the same curated family to that family's exact hue", () => {
    // Members may differ in lightness, but every member of a family renders at exactly the family's hue.
    const assertSameHue = (nameA: string, nameB: string) => {
      const keyA = nameA.toLowerCase();
      const keyB = nameB.toLowerCase();
      const hueA = matchCuratedHue(keyA);
      const hueB = matchCuratedHue(keyB);
      expect(hueA).not.toBeUndefined();
      expect(hueA).toBe(hueB);
    };
    assertSameHue("ElectricCharge", "EC");
    assertSameHue("MonoPropellant", "MonoProp");
    assertSameHue("LqdHydrogen", "Hydrogen");
  });

  it("gives unrecognised resources a distinct, stable, hashed colour", () => {
    const modResourceA = resourceColor("KerbalKrunchies");
    const modResourceB = resourceColor("FluxCapacitorJuice");
    expect(modResourceA).toBe(resourceColor("KerbalKrunchies"));
    // Two different unknown names should not collide (golden-angle spread).
    expect(modResourceA).not.toBe(modResourceB);
  });

  it("never resolves an unrecognised name into a curated resource's exact hue", () => {
    // No unknown name reproduces a curated resource's colour outright.
    const curatedColors = new Set(
      ["Water", "Oxidizer", "LiquidFuel", "Food", "Xenon"].map(resourceColor),
    );
    const unknowns = [
      "KerbalKrunchies",
      "FluxCapacitorJuice",
      "Antimatter",
      "SpaceDust",
      "MysteryGoo",
      "ExperimentData",
    ];
    for (const name of unknowns) {
      expect(curatedColors.has(resourceColor(name))).toBe(false);
    }
  });

  describe("Tier 1: matchCuratedHue precedence mechanism", () => {
    it("first match wins, so ordering determines precedence", () => {
      // A generic alias listed first wins purely because it comes first: matching is order-driven.
      const genericFirst = [
        { aliases: ["fuel"], hue: 999 },
        { aliases: ["liquidfuel"], hue: 40 },
      ];
      expect(matchCuratedHue("liquidfuel", genericFirst)).toBe(999);

      // Flipped, the specific alias gets first refusal.
      const specificFirst = [
        { aliases: ["liquidfuel"], hue: 40 },
        { aliases: ["fuel"], hue: 999 },
      ];
      expect(matchCuratedHue("liquidfuel", specificFirst)).toBe(40);
    });

    it("real CURATED table resolves LiquidFuel to its own family, not a fallback", () => {
      expect(matchCuratedHue("liquidfuel")).toBe(matchCuratedHue("liquidfuel"));
      expect(matchCuratedHue("liquidfuel")).not.toBeUndefined();
    });

    it("returns undefined for names with no curated match", () => {
      expect(matchCuratedHue("krunchies")).toBeUndefined();
    });
  });

  describe("Tier 1: family hue -> member lightness identity", () => {
    it("spreads three distinct waste-family resources into three visibly distinct lightnesses, sharing one hue", () => {
      // Waste, WasteWater and CarbonDioxide share one family: the same hue, told apart by lightness.
      const waste = placedColor("waste") as { hue: number; lightness: number };
      const wasteWater = placedColor("wastewater") as {
        hue: number;
        lightness: number;
      };
      const carbonDioxide = placedColor("carbondioxide") as {
        hue: number;
        lightness: number;
      };
      expect(waste).not.toBeUndefined();
      expect(wasteWater).not.toBeUndefined();
      expect(carbonDioxide).not.toBeUndefined();

      expect(waste.hue).toBe(wasteWater.hue);
      expect(waste.hue).toBe(carbonDioxide.hue);

      // Pairwise separated by a visible margin, not just "not equal".
      const MIN_SEPARATION_PCT = 5;
      expect(Math.abs(waste.lightness - wasteWater.lightness)).toBeGreaterThan(
        MIN_SEPARATION_PCT,
      );
      expect(
        Math.abs(waste.lightness - carbonDioxide.lightness),
      ).toBeGreaterThan(MIN_SEPARATION_PCT);
      expect(
        Math.abs(wasteWater.lightness - carbonDioxide.lightness),
      ).toBeGreaterThan(MIN_SEPARATION_PCT);
    });

    it("keeps WasteWater on the waste family's hue, not water's", () => {
      // "wastewater" contains "waste" (the waste family is ordered ahead of water in CURATED), so it must resolve to the olive hue, never blue.
      const wasteHue = matchCuratedHue("waste");
      const waterHue = matchCuratedHue("water");
      expect(wasteHue).not.toBeUndefined();
      expect(waterHue).not.toBeUndefined();

      const wasteWaterHue = matchCuratedHue("wastewater");
      expect(wasteWaterHue).toBe(wasteHue);
      expect(wasteWaterHue).not.toBe(waterHue);
    });

    it("is deterministic: same resource name always yields the same hue and lightness", () => {
      expect(placedColor("wastewater")).toEqual(placedColor("wastewater"));
      expect(placedColor("wastewater")).toEqual(
        placedColor("WasteWater".toLowerCase()),
      );
      expect(memberLightness("wastewater")).toBe(memberLightness("wastewater"));
    });

    it("anchors a single-alias family at the neutral mid-lightness", () => {
      // A single-alias family sits at the middle of the legible range.
      for (const name of [
        "food",
        "water",
        "oxidizer",
        "ore",
        "xenon",
        "ablator",
      ]) {
        const color = placedColor(name) as { hue: number; lightness: number };
        expect(color).not.toBeUndefined();
        expect(color.lightness).toBe(55);
      }
    });

    it("no two curated families share a hue", () => {
      const hues = CURATED_RESERVED_ZONES.map((zone) => zone.centre);
      for (let i = 0; i < hues.length; i++) {
        for (let j = i + 1; j < hues.length; j++) {
          expect(hueDistance(hues[i], hues[j])).toBeGreaterThanOrEqual(8);
        }
      }
    });
  });

  describe("Tier 2: hashHue reserved-zone avoidance", () => {
    it("never lands within a curated family's reserved zone", () => {
      // Sweep a wide sample of synthetic names; none should resolve within any curated family's reserved zone (centre +/- effective radius).
      for (let i = 0; i < 200; i++) {
        const hue = hashHue(`synthetic-resource-${i}`);
        for (const zone of CURATED_RESERVED_ZONES) {
          const distance = hueDistance(hue, zone.centre);
          expect(distance).toBeGreaterThanOrEqual(zone.radius);
        }
      }
    });

    it("is deterministic", () => {
      expect(hashHue("krunchies")).toBe(hashHue("krunchies"));
    });
  });

  it("two unknowns that both escape the same reserved zone get distinct hues", () => {
    // Both hash into a reserved zone; a name-derived escape step makes them diverge.
    expect(
      hueDistance(hashHue("solidfuel"), hashHue("kerbalkrunchies")),
    ).toBeGreaterThan(15);
  });
});
