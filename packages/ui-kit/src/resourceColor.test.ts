import { describe, expect, it } from "vitest";
import {
  CURATED_RESERVED_ZONES,
  hashHue,
  matchCuratedHue,
  memberLightness,
  placedColor,
  resourceColor,
} from "./resourceColor";

/** Local mirror of the module's own circular-distance helper, kept private
 *  there on purpose; tests need it to reason about reserved-zone membership. */
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
    // Exact numbers are tunable; what matters is each curated resource
    // resolves through Tier 1 (a specific, named hue) rather than falling
    // through to the Tier 2 hash.
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
    // ElectricCharge/EC etc are different full strings, so each may get its
    // OWN deterministic lightness, but the hue is now the family's single
    // shared identity: every member of a family renders at exactly the same
    // hue, never a spread.
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
    // Sample a spread of unknown names and confirm none of them accidentally
    // reproduce a curated resource's colour outright.
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
      // A synthetic table where a short generic alias is listed BEFORE a
      // longer, more specific one that also contains it: the generic one
      // wins purely because it comes first, proving the algorithm is
      // order-driven (not automatically "most specific"), which is exactly
      // why CURATED itself must be authored most-specific-first.
      const genericFirst = [
        { aliases: ["fuel"], hue: 999 },
        { aliases: ["liquidfuel"], hue: 40 },
      ];
      expect(matchCuratedHue("liquidfuel", genericFirst)).toBe(999);

      // Flip the order: the specific alias now gets first refusal, matching
      // the real CURATED table's discipline.
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
      // Waste, WasteWater and CarbonDioxide are three different real
      // resources that share the ["carbondioxide","co2","waste"] family
      // (a single family, not split into hand-picked hues). All three now
      // render at the family's EXACT hue; what tells them apart is
      // lightness, not hue, since hue-only spreading left them 2.8-6deg
      // apart in a crowded region and unreadable as distinct colours.
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

      // Same hue, exactly, for every member.
      expect(waste.hue).toBe(wasteWater.hue);
      expect(waste.hue).toBe(carbonDioxide.hue);

      // Lightness is where the distinctness lives now: pairwise separated
      // by a real, visible margin, not just "not bitwise equal". The
      // tightest real pair (CarbonDioxide/WasteWater) lands ~6.4pts apart.
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
      // "wastewater" contains "waste" (the waste family is ordered ahead of
      // water in CURATED), so it must resolve to the olive hue, never blue.
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
      // Food, Water, Oxidizer, Ore, Xenon and Ablator each have exactly one
      // alias: nothing else shares their neighbourhood, so they sit at the
      // neutral middle of the legible range rather than an arbitrary
      // hash-derived point.
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
      // Sweep a wide sample of synthetic names; none should resolve within
      // any curated family's reserved zone (centre +/- effective radius).
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
    // solidfuel hashes to ~214deg (water's zone) and kerbalkrunchies to ~128deg
    // (food's zone), so both must escape. With a NAME-DERIVED escape step they
    // diverge instead of converging on one hue (the old fixed-step collision
    // put both on the same magenta ~1.7deg apart).
    expect(
      hueDistance(hashHue("solidfuel"), hashHue("kerbalkrunchies")),
    ).toBeGreaterThan(15);
  });
});
