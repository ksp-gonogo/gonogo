import { describe, expect, it } from "vitest";
import { computeUplinkPulse } from "./pendingPulse";

const ENTRY = { dispatchedAt: 1000, oneWaySeconds: 10 };

describe("computeUplinkPulse", () => {
  it("returns null before dispatch (defensive — the queue is dispatch-time only)", () => {
    expect(computeUplinkPulse(ENTRY, 999)).toBeNull();
  });

  it("is on the outbound leg for the first OneWaySeconds, progress 0 at dispatch", () => {
    const pulse = computeUplinkPulse(ENTRY, 1000);
    expect(pulse).not.toBeNull();
    expect(pulse?.leg).toBe("outbound");
    expect(pulse?.progress).toBeCloseTo(0);
  });

  it("reaches progress 1 on the outbound leg exactly at dispatchedAt + oneWaySeconds", () => {
    const pulse = computeUplinkPulse(ENTRY, 1010);
    // At the exact boundary it's still classified outbound-complete, not yet
    // return — the return leg begins strictly after this instant.
    expect(pulse?.leg).toBe("outbound");
    expect(pulse?.progress).toBeCloseTo(1);
  });

  it("switches to the return leg just past the outbound boundary", () => {
    const pulse = computeUplinkPulse(ENTRY, 1010.5);
    expect(pulse?.leg).toBe("return");
    expect(pulse?.progress).toBeCloseTo(0.05);
  });

  it("reaches progress 1 on the return leg at dispatchedAt + 2*oneWaySeconds", () => {
    const pulse = computeUplinkPulse(ENTRY, 1020);
    expect(pulse?.leg).toBe("return");
    expect(pulse?.progress).toBeCloseTo(1);
  });

  it("expires (null) once the round trip completes — the client's own safety net, independent of server pruning", () => {
    expect(computeUplinkPulse(ENTRY, 1020.001)).toBeNull();
  });

  it("fades opacity down over the final fraction of the round trip", () => {
    const early = computeUplinkPulse(ENTRY, 1005);
    const late = computeUplinkPulse(ENTRY, 1019.9);
    expect(early?.opacity).toBe(1);
    expect(late?.opacity).toBeLessThan(1);
    expect(late?.opacity).toBeGreaterThan(0);
  });

  it("degrades to null for a non-finite or non-positive oneWaySeconds", () => {
    expect(
      computeUplinkPulse({ dispatchedAt: 1000, oneWaySeconds: 0 }, 1000),
    ).toBeNull();
    expect(
      computeUplinkPulse(
        { dispatchedAt: 1000, oneWaySeconds: Number.NaN },
        1000,
      ),
    ).toBeNull();
    expect(
      computeUplinkPulse({ dispatchedAt: 1000, oneWaySeconds: -5 }, 1000),
    ).toBeNull();
  });
});
