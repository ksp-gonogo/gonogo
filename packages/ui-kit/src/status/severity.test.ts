import { describe, expect, it } from "vitest";
import {
  type Severity,
  severityFromBadgeEntryTone,
  severityFromStreamStatus,
  severityRank,
  worstSeverity,
} from "./severity";

const ORDER: Severity[] = [
  "nominal",
  "info",
  "caution",
  "warning",
  "critical",
  "offline",
];

describe("Severity total order", () => {
  it("ranks best-to-worst nominal < info < caution < warning < critical < offline", () => {
    for (let i = 1; i < ORDER.length; i++) {
      expect(severityRank(ORDER[i])).toBeGreaterThan(
        severityRank(ORDER[i - 1]),
      );
    }
  });

  it("puts info ABOVE nominal (operator-locked: an info notice lights a quiet panel)", () => {
    expect(severityRank("info")).toBeGreaterThan(severityRank("nominal"));
  });

  it("puts offline at the very top, above critical", () => {
    expect(severityRank("offline")).toBeGreaterThan(severityRank("critical"));
  });
});

describe("worstSeverity max-merge", () => {
  it("is vacuously the floor (nominal) for an empty set", () => {
    expect(worstSeverity([])).toBe("nominal");
  });

  it("returns the single element for a singleton", () => {
    for (const s of ORDER) expect(worstSeverity([s])).toBe(s);
  });

  it("returns the worst across every unordered pair", () => {
    for (const a of ORDER) {
      for (const b of ORDER) {
        const expected = severityRank(a) >= severityRank(b) ? a : b;
        expect(worstSeverity([a, b])).toBe(expected);
        expect(worstSeverity([b, a])).toBe(expected);
      }
    }
  });

  it("lets offline win over critical (data gone cannot be trusted below it)", () => {
    expect(worstSeverity(["critical", "offline"])).toBe("offline");
    expect(worstSeverity(["offline", "critical", "warning"])).toBe("offline");
  });

  it("lets info win over a wholly-nominal set", () => {
    expect(worstSeverity(["nominal", "info", "nominal"])).toBe("info");
  });
});

// One assertion per row of the spec mapping table (Scale B column), so the
// table and the code cannot drift.
describe("severityFromStreamStatus (mapping table)", () => {
  it("live -> nominal", () => {
    expect(severityFromStreamStatus("live")).toBe("nominal");
  });
  it("resyncing -> caution", () => {
    expect(severityFromStreamStatus("resyncing")).toBe("caution");
  });
  it("held-stale -> warning", () => {
    expect(severityFromStreamStatus("held-stale")).toBe("warning");
  });
  it("last-before-blackout -> warning", () => {
    expect(severityFromStreamStatus("last-before-blackout")).toBe("warning");
  });
  it("disconnected -> offline", () => {
    expect(severityFromStreamStatus("disconnected")).toBe("offline");
  });
  it("absent -> offline", () => {
    expect(severityFromStreamStatus("absent")).toBe("offline");
  });
});

describe("severityFromBadgeEntryTone (mapping table)", () => {
  it("go -> nominal", () => {
    expect(severityFromBadgeEntryTone("go")).toBe("nominal");
  });
  it("info -> info", () => {
    expect(severityFromBadgeEntryTone("info")).toBe("info");
  });
  it("warn -> warning", () => {
    expect(severityFromBadgeEntryTone("warn")).toBe("warning");
  });
  it("nogo -> critical", () => {
    expect(severityFromBadgeEntryTone("nogo")).toBe("critical");
  });
  it("neutral -> nominal (decorative folds to the floor)", () => {
    expect(severityFromBadgeEntryTone("neutral")).toBe("nominal");
  });
});
