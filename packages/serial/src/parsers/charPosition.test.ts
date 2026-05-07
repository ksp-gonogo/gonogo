import { describe, expect, it } from "vitest";
import type { DeviceInput } from "../types";
import { parseCharPosition } from "./charPosition";

describe("parseCharPosition", () => {
  it("parses button inputs — '1' → true, '0' → false", () => {
    const inputs: DeviceInput[] = [
      { id: "a", name: "A", kind: "button", offset: 1, length: 1 },
      { id: "b", name: "B", kind: "button", offset: 3, length: 1 },
    ];
    // Matches the prototype's `charAt(1)` / `charAt(3)` layout: "xAxBx".
    expect(parseCharPosition(" 1 0 ", inputs)).toEqual([
      { inputId: "a", value: true },
      { inputId: "b", value: false },
    ]);
  });

  it("normalises analog inputs to -1..1 from declared min/max", () => {
    const inputs: DeviceInput[] = [
      {
        id: "x",
        name: "X",
        kind: "analog",
        offset: 0,
        length: 3,
        min: 0,
        max: 255,
      },
    ];
    const [mid] = parseCharPosition("128", inputs);
    expect(mid?.inputId).toBe("x");
    expect(typeof mid?.value).toBe("number");
    expect(mid?.value).toBeCloseTo(0.004, 2); // 128 is very near the centre
    expect(parseCharPosition("000", inputs)[0]?.value).toBe(-1);
    expect(parseCharPosition("255", inputs)[0]?.value).toBe(1);
  });

  it("clamps analog values outside min/max to -1..1", () => {
    const inputs: DeviceInput[] = [
      {
        id: "x",
        name: "X",
        kind: "analog",
        offset: 0,
        length: 4,
        min: 0,
        max: 100,
      },
    ];
    expect(parseCharPosition("-050", inputs)[0]?.value).toBe(-1);
    expect(parseCharPosition("9999", inputs)[0]?.value).toBe(1);
  });

  it("skips inputs whose slice falls outside the line", () => {
    const inputs: DeviceInput[] = [
      { id: "a", name: "A", kind: "button", offset: 10, length: 1 },
    ];
    expect(parseCharPosition("1", inputs)).toEqual([]);
  });

  it("skips analog inputs whose slice is NaN", () => {
    const inputs: DeviceInput[] = [
      {
        id: "x",
        name: "X",
        kind: "analog",
        offset: 0,
        length: 3,
        min: 0,
        max: 255,
      },
    ];
    expect(parseCharPosition("abc", inputs)).toEqual([]);
  });

  it("skips inputs missing offset or length", () => {
    const inputs: DeviceInput[] = [{ id: "a", name: "A", kind: "button" }];
    expect(parseCharPosition(" 1 ", inputs)).toEqual([]);
  });

  it("applies deadzone to analog inputs (snaps small values to zero)", () => {
    const inputs: DeviceInput[] = [
      {
        id: "x",
        name: "X",
        kind: "analog",
        offset: 0,
        length: 3,
        min: 0,
        max: 100,
        deadzone: 0.1,
      },
    ];
    // Raw 50 → normalised 0 → already inside the deadzone, should snap to 0.
    expect(parseCharPosition("050", inputs)[0]?.value).toBe(0);
    // Raw 53 → normalised 0.06 — still inside the deadzone.
    expect(parseCharPosition("053", inputs)[0]?.value).toBe(0);
  });

  it("applies a squared curve after the deadzone", () => {
    const inputs: DeviceInput[] = [
      {
        id: "x",
        name: "X",
        kind: "analog",
        offset: 0,
        length: 3,
        min: 0,
        max: 100,
        curve: "squared",
      },
    ];
    // Raw 75 → normalised 0.5 → squared 0.25.
    expect(parseCharPosition("075", inputs)[0]?.value).toBeCloseTo(0.25, 2);
  });
});
