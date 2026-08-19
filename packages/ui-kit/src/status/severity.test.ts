import { describe, expect, it } from "vitest";
import {
  type Severity,
  severityFromBadgeTone,
  severityFromReadoutTone,
  severityFromStatusTone,
  severityFromStreamStatus,
  severityFromTextTone,
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

describe("severityFromReadoutTone (mapping table)", () => {
  it("default -> nominal", () => {
    expect(severityFromReadoutTone("default")).toBe("nominal");
  });
  it("go -> nominal", () => {
    expect(severityFromReadoutTone("go")).toBe("nominal");
  });
  it("warning -> warning", () => {
    expect(severityFromReadoutTone("warning")).toBe("warning");
  });
  it("alert -> warning", () => {
    expect(severityFromReadoutTone("alert")).toBe("warning");
  });
});

describe("severityFromBadgeTone (mapping table)", () => {
  it("go -> nominal", () => {
    expect(severityFromBadgeTone("go")).toBe("nominal");
  });
  it("info -> info", () => {
    expect(severityFromBadgeTone("info")).toBe("info");
  });
  it("warn -> warning", () => {
    expect(severityFromBadgeTone("warn")).toBe("warning");
  });
  it("nogo -> critical", () => {
    expect(severityFromBadgeTone("nogo")).toBe("critical");
  });
  it("neutral -> nominal (decorative folds to the floor)", () => {
    expect(severityFromBadgeTone("neutral")).toBe("nominal");
  });
});

describe("severityFromStatusTone (mapping table)", () => {
  it("neutral -> nominal", () => {
    expect(severityFromStatusTone("neutral")).toBe("nominal");
  });
  it("info -> info", () => {
    expect(severityFromStatusTone("info")).toBe("info");
  });
  it("go -> nominal", () => {
    expect(severityFromStatusTone("go")).toBe("nominal");
  });
  it("warn -> warning", () => {
    expect(severityFromStatusTone("warn")).toBe("warning");
  });
  it("nogo -> critical", () => {
    expect(severityFromStatusTone("nogo")).toBe("critical");
  });
});

describe("severityFromTextTone (display tones carry no severity)", () => {
  it("folds every display tone to the nominal floor", () => {
    for (const t of ["accent", "default", "muted", "faint"] as const) {
      expect(severityFromTextTone(t)).toBe("nominal");
    }
  });
});
