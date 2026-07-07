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
      "held-stale",
      "last-before-blackout",
      "absent",
      "resyncing",
    ];
    for (const v of values) {
      expect(worstStatus([v])).toBe(v);
    }
  });

  it("full severity ordering: live < held-stale < last-before-blackout < absent < resyncing", () => {
    expect(worstStatus(["live", "held-stale"])).toBe("held-stale");
    expect(worstStatus(["held-stale", "last-before-blackout"])).toBe(
      "last-before-blackout",
    );
    expect(worstStatus(["last-before-blackout", "absent"])).toBe("absent");
    expect(worstStatus(["absent", "resyncing"])).toBe("resyncing");
  });

  it("order of the input list doesn't matter", () => {
    expect(worstStatus(["resyncing", "live", "held-stale"])).toBe("resyncing");
    expect(worstStatus(["held-stale", "live", "resyncing"])).toBe("resyncing");
  });

  it("ties resolve to the tied value", () => {
    expect(worstStatus(["held-stale", "held-stale"])).toBe("held-stale");
  });

  it("a single 'live' among many worse statuses does not win", () => {
    expect(worstStatus(["live", "live", "absent", "live"])).toBe("absent");
  });
});
