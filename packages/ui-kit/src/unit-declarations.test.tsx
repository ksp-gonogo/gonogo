import { registerUnit, value } from "@ksp-gonogo/sitrep-sdk";
import { render } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { Unit } from "./Unit";
import { UnitSharedFormat } from "./UnitSharedFormat";
import {
  formatGroupKey,
  formatQuantity,
  kindOfUnit,
  pinGroupKey,
  speakQuantity,
} from "./units";

/**
 * A unit declared the way an Uplink declares one, read back through every
 * runtime surface a first-party unit reaches: kind lookup, rung choice, a pinned
 * format, the pin group a scope addresses, and the spoken word.
 *
 * Everything here goes through the one registration call on the SDK. Nothing
 * reaches for a second, kit-side registry, because there is none.
 */
declare module "@ksp-gonogo/sitrep-sdk" {
  interface UnitDeclarations {
    "snax:bite": {
      kind: "snaxAmount";
      dim: { readonly snax: 1 };
      ratio: 1;
      ladder: "snax";
    };
    "snax:crate": {
      kind: "snaxAmount";
      dim: { readonly snax: 1 };
      ratio: 1000;
      ladder: "snax";
    };
    "snax:mood": { kind: "snaxMood"; dim: { readonly snaxMood: 1 }; ratio: 1 };
    "snax:grin": { kind: "snaxMood"; dim: { readonly snaxMood: 1 }; ratio: 10 };
    "snax:reach": { kind: "length"; dim: { readonly m: 1 }; ratio: 1 };
  }
}

const SNAX_RUNGS = [
  { from: 0, symbol: "snax:bite", per: 1 },
  { from: 1e3, symbol: "snax:crate", per: 1e3 },
];

registerUnit({
  symbol: "snax:bite",
  kind: "snaxAmount",
  dimension: { snax: 1 },
  ratio: 1,
  ladder: "snax",
  rungs: SNAX_RUNGS,
  decimals: 1,
  word: "bites",
});
registerUnit({
  symbol: "snax:crate",
  kind: "snaxAmount",
  dimension: { snax: 1 },
  ratio: 1000,
  ladder: "snax",
  rungs: SNAX_RUNGS,
  word: "crates",
});
registerUnit({
  symbol: "snax:mood",
  kind: "snaxMood",
  dimension: { snaxMood: 1 },
  ratio: 1,
  decimals: 0,
});
registerUnit({
  symbol: "snax:grin",
  kind: "snaxMood",
  dimension: { snaxMood: 1 },
  ratio: 10,
});
registerUnit({
  symbol: "snax:reach",
  kind: "length",
  dimension: { m: 1 },
  ratio: 1,
});

describe("a unit declared through the SDK", () => {
  it("has the kind its declaration states", () => {
    expect(kindOfUnit("snax:bite")).toBe("snaxAmount");
    expect(kindOfUnit("snax:grin")).toBe("snaxMood");
  });

  it("climbs the rungs its ladder was registered with", () => {
    expect(formatQuantity(2500, "snax:bite")).toMatchObject({
      value: "2.5",
      symbol: "snax:crate",
    });
  });

  it("pins a format to another unit of its kind, converting by the declared ratios", () => {
    expect(
      formatQuantity(3, "snax:grin", { format: "snax:mood" }),
    ).toMatchObject({ value: "30", symbol: "snax:mood" });
  });

  it("settles one group with every unit on its ladder, addressed by the ladder's name", () => {
    expect(formatGroupKey("snax:bite")).toBe(formatGroupKey("snax:crate"));
    expect(pinGroupKey("snax")).toBe(formatGroupKey("snax:bite"));
    // The first-party shape of the same rule.
    expect(pinGroupKey("length")).toBe(formatGroupKey("km"));
  });

  it("groups by itself when it names no ladder, as an unladdered first-party unit does", () => {
    expect(pinGroupKey("snax:mood")).toBe(formatGroupKey("snax:mood"));
    expect(formatGroupKey("snax:mood")).not.toBe(formatGroupKey("snax:grin"));
    expect(pinGroupKey("s")).toBe(formatGroupKey("s"));
    expect(formatGroupKey("s")).not.toBe(formatGroupKey("min"));
  });

  it("does not borrow the ladder of a kind it happens to share", () => {
    // Its declaration names no ladder, so it is a group of its own and never
    // climbs, whatever its kind's first-party units do.
    expect(formatQuantity(12_400, "snax:reach").symbol).toBe("snax:reach");
    expect(formatGroupKey("snax:reach")).not.toBe(formatGroupKey("m"));
  });

  it("is spoken by its word", () => {
    expect(speakQuantity(value("snax:bite", 4))).toBe("4.0 bites");
  });

  it("takes a scope's pin addressed to its ladder", () => {
    const { container } = render(
      <UnitSharedFormat pins={{ snax: { format: "snax:crate" } }}>
        <Unit value={value("snax:bite", 500)} />
        <Unit value={value("snax:bite", 2500)} />
      </UnitSharedFormat>,
    );
    expect(container.textContent).toContain("0.5");
    expect(container.textContent).toContain("2.5");
    expect(container.textContent).not.toContain("500.0");
  });
});
