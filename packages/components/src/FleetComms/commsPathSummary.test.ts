import { describe, expect, it } from "vitest";
import { describeCommsPath } from "./commsPathSummary";

describe("describeCommsPath", () => {
  it("reports no path when the payload is missing", () => {
    expect(describeCommsPath(undefined)).toBe("No comms path home");
  });

  it("reports no path when hops is empty (a real control-loss state)", () => {
    expect(describeCommsPath({ hops: [], meta: {} as never })).toBe(
      "No comms path home",
    );
  });

  it("chains hop from/to names for a direct home link", () => {
    const summary = describeCommsPath({
      hops: [{ from: "Vessel", to: "KSC", kind: 0 }],
      meta: {} as never,
    });
    expect(summary).toBe("Vessel -> KSC");
  });

  it("chains through relays and counts them", () => {
    const summary = describeCommsPath({
      hops: [
        { from: "Vessel", to: "Relay-A", kind: 1 },
        { from: "Relay-A", to: "KSC", kind: 0 },
      ],
      meta: {} as never,
    });
    expect(summary).toBe("Vessel -> Relay-A -> KSC (1 relay)");
  });

  it("pluralises the relay count", () => {
    const summary = describeCommsPath({
      hops: [
        { from: "Vessel", to: "Relay-A", kind: 1 },
        { from: "Relay-A", to: "Relay-B", kind: 1 },
        { from: "Relay-B", to: "KSC", kind: 0 },
      ],
      meta: {} as never,
    });
    expect(summary).toBe("Vessel -> Relay-A -> Relay-B -> KSC (2 relays)");
  });
});
