import { describe, expect, it } from "vitest";
import {
  type Severity,
  severityFromStreamStatus,
  severityRank,
  worstSeverity,
} from "./severity";

const ORDER: Severity[] = ["go", "info", "caution", "warn", "nogo", "offline"];

describe("Severity total order", () => {
  it("ranks best-to-worst go < info < caution < warn < nogo < offline", () => {
    for (let i = 1; i < ORDER.length; i++) {
      expect(severityRank(ORDER[i])).toBeGreaterThan(
        severityRank(ORDER[i - 1]),
      );
    }
  });

  it("puts info ABOVE go, so an info notice lights a quiet panel", () => {
    expect(severityRank("info")).toBeGreaterThan(severityRank("go"));
  });

  it("puts offline at the very top, above nogo", () => {
    expect(severityRank("offline")).toBeGreaterThan(severityRank("nogo"));
  });
});

describe("worstSeverity max-merge", () => {
  it("is vacuously the floor (go) for an empty set", () => {
    expect(worstSeverity([])).toBe("go");
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

  it("lets offline win over nogo (data gone cannot be trusted below it)", () => {
    expect(worstSeverity(["nogo", "offline"])).toBe("offline");
    expect(worstSeverity(["offline", "nogo", "warn"])).toBe("offline");
  });

  it("lets info win over a wholly-go set", () => {
    expect(worstSeverity(["go", "info", "go"])).toBe("info");
  });
});

// One assertion per mapping row, so the mapping and the code cannot drift.
describe("severityFromStreamStatus (mapping table)", () => {
  it("live -> go", () => {
    expect(severityFromStreamStatus("live")).toBe("go");
  });
  it("resyncing -> caution", () => {
    expect(severityFromStreamStatus("resyncing")).toBe("caution");
  });
  it("held -> warn", () => {
    expect(severityFromStreamStatus("held")).toBe("warn");
  });
  it("last-before-blackout -> warn", () => {
    expect(severityFromStreamStatus("last-before-blackout")).toBe("warn");
  });
  it("disconnected -> offline", () => {
    expect(severityFromStreamStatus("disconnected")).toBe("offline");
  });
  it("absent -> offline", () => {
    expect(severityFromStreamStatus("absent")).toBe("offline");
  });
});
