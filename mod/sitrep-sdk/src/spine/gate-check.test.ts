import { describe, expect, it } from "vitest";
import { GateOutcome } from "../__generated__/contract";
import { gateCheckKey, readGateCheckReply } from "./gate-check";

describe("readGateCheckReply", () => {
  it("reads the verdict out of an answered check", () => {
    const verdict = { outcome: GateOutcome.Fail, detail: "far" };
    expect(readGateCheckReply({ success: true, payload: verdict })).toBe(
      verdict,
    );
  });

  it("reads a refused check, a missing payload and a payload with no outcome as no answer", () => {
    expect(readGateCheckReply({ success: false })).toBeUndefined();
    expect(readGateCheckReply({ success: true })).toBeUndefined();
    expect(
      readGateCheckReply({ success: true, payload: { detail: "x" } }),
    ).toBeUndefined();
    expect(readGateCheckReply(undefined)).toBeUndefined();
  });
});

describe("gateCheckKey", () => {
  it("is the same for the same values in a different property order", () => {
    expect(gateCheckKey({ a: 1, b: { c: 2, d: 3 } })).toBe(
      gateCheckKey({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("differs when a value differs", () => {
    expect(gateCheckKey({ site: "LaunchPad" })).not.toBe(
      gateCheckKey({ site: "Runway" }),
    );
  });
});
