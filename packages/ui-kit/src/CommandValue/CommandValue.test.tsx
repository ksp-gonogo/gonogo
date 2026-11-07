import { describe, expect, it } from "vitest";
import { commandValueMarks } from "./CommandValue";

describe("commandValueMarks", () => {
  it("draws the expected value only where it differs from the command", () => {
    expect(
      commandValueMarks({ commanded: 0, expected: 1, step: 0.01 }),
    ).toEqual({ expected: 1, lastSeen: null, onCommanded: false });
    expect(
      commandValueMarks({ commanded: 0.5, expected: 0.5, step: 0.01 }).expected,
    ).toBeNull();
  });

  it("draws the last-seen value whenever it is given, and the expected one only where it differs from it too", () => {
    expect(
      commandValueMarks({
        commanded: 0.5,
        expected: 0,
        lastSeen: 0,
        step: 0.01,
      }),
    ).toEqual({ expected: null, lastSeen: 0, onCommanded: false });
    expect(
      commandValueMarks({ commanded: 300, lastSeen: 300, step: 10 }),
    ).toEqual({ expected: null, lastSeen: 300, onCommanded: true });
  });
});
