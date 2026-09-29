import { describe, expect, it } from "vitest";
import type { StreamStatusValue } from "./stream-status";
import { worstStatus } from "./stream-status";

describe("worstStatus", () => {
  it("empty input is vacuously 'live'", () => {
    expect(worstStatus([])).toBe("live");
  });

  it("a single status passes through unchanged", () => {
    const values: StreamStatusValue[] = [
      "live",
      "held",
      "disconnected",
      "last-before-blackout",
      "absent",
      "resyncing",
    ];
    for (const v of values) {
      expect(worstStatus([v])).toBe(v);
    }
  });

  it("full severity ordering: live < held < disconnected < last-before-blackout < absent < resyncing", () => {
    expect(worstStatus(["live", "held"])).toBe("held");
    expect(worstStatus(["held", "disconnected"])).toBe("disconnected");
    expect(worstStatus(["disconnected", "last-before-blackout"])).toBe(
      "last-before-blackout",
    );
    expect(worstStatus(["last-before-blackout", "absent"])).toBe("absent");
    expect(worstStatus(["absent", "resyncing"])).toBe("resyncing");
  });

  it("order of the input list doesn't matter", () => {
    expect(worstStatus(["resyncing", "live", "held"])).toBe("resyncing");
    expect(worstStatus(["held", "live", "resyncing"])).toBe("resyncing");
  });

  it("ties resolve to the tied value", () => {
    expect(worstStatus(["held", "held"])).toBe("held");
  });

  it("a single 'live' among many worse statuses does not win", () => {
    expect(worstStatus(["live", "live", "absent", "live"])).toBe("absent");
  });
});
