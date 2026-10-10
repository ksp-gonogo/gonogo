import { registerStockBodies } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import { bodyFromStream } from "./streamBody";

describe("whether the body has an ocean", () => {
  const facts = { index: 1, name: "Kerbin", radius: 600_000 };

  it("is the flag the stream reports", () => {
    expect(bodyFromStream({ ...facts, hasOcean: true })?.hasOcean).toBe(true);
    expect(bodyFromStream({ ...facts, hasOcean: false })?.hasOcean).toBe(false);
  });

  it("is unknown, not false, when the stream does not say", () => {
    expect(bodyFromStream(facts)?.hasOcean).toBeUndefined();
    expect(
      bodyFromStream({ ...facts, hasOcean: null })?.hasOcean,
    ).toBeUndefined();
  });
});

describe("the colour of the body's seas", () => {
  registerStockBodies();

  it("comes from the body's registry entry: Eve's purple, Kerbin's blue, Laythe's slate", () => {
    expect(bodyFromStream({ name: "Eve", radius: 700_000 })?.liquidColor).toBe(
      "#AD94BE",
    );
    expect(
      bodyFromStream({ name: "Kerbin", radius: 600_000 })?.liquidColor,
    ).toBe("#243B47");
    expect(
      bodyFromStream({ name: "Laythe", radius: 500_000 })?.liquidColor,
    ).toBe("#1E2028");
  });

  it("is absent for a body with no seas, and for one the registry does not know", () => {
    expect(
      bodyFromStream({ name: "Mun", radius: 200_000 })?.liquidColor,
    ).toBeUndefined();
    expect(
      bodyFromStream({ name: "Rask", radius: 400_000 })?.liquidColor,
    ).toBeUndefined();
  });
});
