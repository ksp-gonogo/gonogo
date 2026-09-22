import type { LogEntry } from "@ksp-gonogo/logger";
import { describe, expect, it } from "vitest";
import { classifyShadowRun, MINIMUM_FIRINGS } from "./shadowAcceptance";

function entry(message: string, level: LogEntry["level"] = "info"): LogEntry {
  return { level, message, timestamp: "2026-09-22T00:00:00.000Z" };
}

const agree = (n: number) =>
  Array.from({ length: n }, () =>
    entry("alarm-shadow: client fired, mod had already agreed"),
  );

/**
 * The classifier decides whether an alarm feature may be handed to the mod, and
 * a run that comes back clean is unlikely to be checked by hand. So what is
 * asserted here is mostly that it can REFUSE: each disagreement on its own, and
 * each way a quiet run can be empty rather than agreed.
 */
describe("classifyShadowRun", () => {
  it("passes only on enough agreements, at a real delay, with nothing else", () => {
    const v = classifyShadowRun({
      entries: agree(MINIMUM_FIRINGS),
      owltSeconds: 240,
    });
    expect(v.verdict).toBe("PASS");
    expect(v.agreements).toBe(MINIMUM_FIRINGS);
  });

  it.each([
    "alarm-shadow: mod fired first, client still pending",
    "alarm-shadow: client fired, mod has not",
    "alarm-shadow: mod fired an alarm this client does not hold",
  ])("fails on a single '%s', however many agreements surround it", (bad) => {
    const v = classifyShadowRun({
      entries: [...agree(50), entry(bad, "warn")],
      owltSeconds: 240,
    });
    expect(v.verdict).toBe("FAIL");
    expect(v.disagreements).toBe(1);
    expect(v.divergences[0]?.message).toBe(bad);
  });

  it("refuses to call a zero-delay run a pass, however clean", () => {
    const v = classifyShadowRun({ entries: agree(500), owltSeconds: 0 });
    expect(v.verdict).toBe("INCONCLUSIVE");
  });

  it("refuses a null delay, which is the mod's word for nothing measurable", () => {
    const v = classifyShadowRun({ entries: agree(500), owltSeconds: null });
    expect(v.verdict).toBe("INCONCLUSIVE");
  });

  it("calls a quiet run inconclusive rather than passing it", () => {
    const v = classifyShadowRun({
      entries: agree(MINIMUM_FIRINGS - 1),
      owltSeconds: 240,
    });
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.reason).toContain("inactivity");
  });

  it("is not fooled by an empty log, which is the commonest way to see nothing", () => {
    const v = classifyShadowRun({ entries: [], owltSeconds: 240 });
    expect(v.verdict).toBe("INCONCLUSIVE");
  });

  it("ignores log lines that are not the shadow comparison's", () => {
    const v = classifyShadowRun({
      entries: [
        ...agree(MINIMUM_FIRINGS),
        entry("alarm-host: something else", "warn"),
      ],
      owltSeconds: 240,
    });
    expect(v.verdict).toBe("PASS");
  });
});
