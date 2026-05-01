import { describe, expect, it } from "vitest";
import { getSizeBucket } from "./widgetSize";

describe("getSizeBucket", () => {
  it("returns 'normal' when dimensions are missing", () => {
    expect(getSizeBucket(undefined, undefined)).toBe("normal");
    expect(getSizeBucket(3, undefined)).toBe("normal");
    expect(getSizeBucket(undefined, 3)).toBe("normal");
  });

  it("classifies tiny when either axis is below the tiny floor", () => {
    expect(getSizeBucket(3, 3)).toBe("tiny");
    expect(getSizeBucket(4, 6)).toBe("tiny"); // w<5
    expect(getSizeBucket(8, 3)).toBe("tiny"); // h<4
  });

  it("classifies small when below the small floor but above tiny", () => {
    expect(getSizeBucket(5, 4)).toBe("small");
    expect(getSizeBucket(7, 6)).toBe("small");
    expect(getSizeBucket(5, 10)).toBe("small"); // w<8 even if h is generous
  });

  it("classifies normal at or above the small cutoff", () => {
    expect(getSizeBucket(8, 7)).toBe("normal");
    expect(getSizeBucket(12, 18)).toBe("normal");
  });
});
