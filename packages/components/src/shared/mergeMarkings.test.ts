import { describe, expect, it } from "vitest";
import { mergeMarkings } from "./mergeMarkings";

const HELD = { kind: "held", caption: "held" } as const;
const MODELLED = { kind: "modelled", caption: "modelled" } as const;

describe("mergeMarkings", () => {
  it("is null while every basis is current", () => {
    expect(mergeMarkings(null, null)).toBeNull();
    expect(mergeMarkings()).toBeNull();
  });

  it("takes the one mark there is", () => {
    expect(mergeMarkings(null, MODELLED)).toBe(MODELLED);
    expect(mergeMarkings(HELD, null)).toBe(HELD);
  });

  it("lets a held basis outrank a modelled one, in either order", () => {
    expect(mergeMarkings(MODELLED, HELD)).toBe(HELD);
    expect(mergeMarkings(HELD, MODELLED)).toBe(HELD);
  });
});
