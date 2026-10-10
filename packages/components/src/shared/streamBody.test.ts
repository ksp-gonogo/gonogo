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
