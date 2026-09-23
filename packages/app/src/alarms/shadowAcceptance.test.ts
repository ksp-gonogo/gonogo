import type { LogEntry } from "@ksp-gonogo/logger";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  classifyShadowRun,
  MINIMUM_FIRINGS,
  SHADOW_LINES,
  type ShadowRunInput,
} from "./shadowAcceptance";

function line(
  message: string,
  id: string | null,
  warpRate: number | null = 1,
): LogEntry {
  return {
    level: message.includes("agree") ? "info" : "warn",
    message,
    timestamp: "2026-09-22T00:00:00.000Z",
    context: id === null ? { warpRate } : { id, warpRate },
  };
}

/** One mod-first fire and the client's agreement that closes it. */
function pairedFire(id: string, warpRate: number | null = 1): LogEntry[] {
  return [
    line(SHADOW_LINES.modFirst, id, warpRate),
    line(SHADOW_LINES.clientAgrees, id, warpRate),
  ];
}

/** `n` paired fires on distinct alarms, the first of them under warp. */
function pairedRun(n: number): LogEntry[] {
  return Array.from({ length: n }, (_, i) =>
    pairedFire(`a${i}`, i === 0 ? 1000 : 1),
  ).flat();
}

function classify(
  entries: LogEntry[],
  extra: Partial<ShadowRunInput> = {},
): ReturnType<typeof classifyShadowRun> {
  return classifyShadowRun({ entries, owlt: value("s", 240), ...extra });
}

/**
 * The classifier decides whether an alarm feature may be handed to the mod, and
 * a run that comes back clean is unlikely to be checked by hand. So what is
 * asserted here is mostly that it can REFUSE, and that it refuses for the
 * right reason: a disagreement is a FAIL, and a run too short or too tame to
 * show anything is INCONCLUSIVE, never the other way round.
 */
describe("classifyShadowRun", () => {
  it("passes on enough paired fires, one under warp, at a real delay", () => {
    const v = classify(pairedRun(MINIMUM_FIRINGS));
    expect(v.verdict).toBe("PASS");
    expect(v.outcomes.paired).toBe(MINIMUM_FIRINGS);
    expect(v.pairedUnderWarp).toBe(1);
  });

  it("names the delay it passed at to the millisecond", () => {
    const v = classify(pairedRun(MINIMUM_FIRINGS), {
      owlt: value("s", 2.675),
    });
    expect(v.reason).toMatch(/one-way delay of 2\.675\s*s$/);
  });

  it("counts the mod firing first and the client agreeing as one agreed fire", () => {
    const v = classify(pairedRun(MINIMUM_FIRINGS));
    expect(v.fires.every((f) => f.outcome === "paired")).toBe(true);
    expect(v.fires[0]?.lines.map((l) => l.message)).toEqual([
      SHADOW_LINES.modFirst,
      SHADOW_LINES.clientAgrees,
    ]);
  });

  it("fails a fire the client reached first, even once the mod agrees", () => {
    const v = classify([
      ...pairedRun(MINIMUM_FIRINGS),
      line(SHADOW_LINES.clientFirst, "late"),
      line(SHADOW_LINES.modAgrees, "late"),
    ]);
    expect(v.verdict).toBe("FAIL");
    expect(v.outcomes["client-first"]).toBe(1);
  });

  it("fails a client-first fire the mod never answers", () => {
    const v = classify([
      ...pairedRun(MINIMUM_FIRINGS),
      line(SHADOW_LINES.clientFirst, "late"),
    ]);
    expect(v.verdict).toBe("FAIL");
    expect(v.outcomes["client-first"]).toBe(1);
  });

  it.each([
    [
      "the mod fired an alarm this client does not hold",
      [line(SHADOW_LINES.modUnheld, "stranger")],
    ],
    [
      "a client agreement with no mod fire to close",
      [line(SHADOW_LINES.clientAgrees, "orphan")],
    ],
    [
      "a mod agreement with no client fire to close",
      [line(SHADOW_LINES.modAgrees, "orphan")],
    ],
    [
      "a mod fire the next fire of the same alarm overtook",
      [line(SHADOW_LINES.modFirst, "twice"), ...pairedFire("twice")],
    ],
    ["a shadow line with no alarm id", [line(SHADOW_LINES.modFirst, null)]],
  ])("fails a fire seen by one side only: %s", (_label, bad) => {
    const v = classify([...pairedRun(MINIMUM_FIRINGS), ...bad]);
    expect(v.verdict).toBe("FAIL");
    expect(v.outcomes["one-sided"]).toBe(1);
  });

  it("keeps a mod fire still in flight at the end of the log inconclusive, not failed", () => {
    const v = classify([
      ...pairedRun(MINIMUM_FIRINGS),
      line(SHADOW_LINES.modFirst, "in-flight"),
    ]);
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.outcomes.unresolved).toBe(1);
  });

  it("pairs each alarm's lines with its own, however they interleave", () => {
    const v = classify(
      [
        line(SHADOW_LINES.modFirst, "x", 1000),
        line(SHADOW_LINES.modFirst, "y"),
        line(SHADOW_LINES.clientAgrees, "y"),
        line(SHADOW_LINES.clientAgrees, "x", 1000),
      ],
      { minimumFires: 2 },
    );
    expect(v.verdict).toBe("PASS");
    expect(v.pairedByAlarm).toEqual({ x: 1, y: 1 });
  });

  it("treats too few fires as a short run, not a disagreement", () => {
    const v = classify(pairedRun(MINIMUM_FIRINGS - 1));
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.reason).toContain("inactivity");
  });

  it("takes the sample floor it is given", () => {
    expect(classify(pairedRun(3), { minimumFires: 3 }).verdict).toBe("PASS");
    expect(classify(pairedRun(3), { minimumFires: 4 }).verdict).toBe(
      "INCONCLUSIVE",
    );
  });

  it("holds out for a paired fire under warp", () => {
    const tame = Array.from({ length: MINIMUM_FIRINGS }, (_, i) =>
      pairedFire(`a${i}`, 1),
    ).flat();
    const v = classify(tame);
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.reason).toContain("warp");
  });

  it("does not read a fire with no recorded rate as one under warp", () => {
    const unrecorded = Array.from({ length: MINIMUM_FIRINGS }, (_, i) =>
      pairedFire(`a${i}`, null),
    ).flat();
    const v = classify(unrecorded);
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.fires[0]?.warpRate).toBeNull();
  });

  it("holds out until every alarm has a paired fire on every lap", () => {
    const entries = [...pairedRun(MINIMUM_FIRINGS), ...pairedFire("a0", 1000)];
    const v = classify(entries, { laps: { count: 2, alarms: ["a0", "a1"] } });
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.reason).toContain("a1");
    expect(v.pairedByAlarm.a0).toBe(2);
  });

  it("counts laps per alarm when each lap re-arms under a fresh id", () => {
    const lapsFlown = 5;
    const entries = Array.from({ length: lapsFlown }, (_, lap) => [
      ...pairedFire(`apo-${lap}`, lap === 0 ? 1000 : 1),
      ...pairedFire(`peri-${lap}`),
    ]).flat();
    const laps = {
      alarms: ["apo", "peri"],
      alarmOf: (f: { id: string }) => f.id.split("-")[0] ?? f.id,
    };
    expect(classify(entries, { laps: { ...laps, count: 5 } }).verdict).toBe(
      "PASS",
    );
    expect(classify(entries, { laps: { ...laps, count: 6 } }).verdict).toBe(
      "INCONCLUSIVE",
    );
  });

  it("sets an excluded class aside under its name, for and against", () => {
    const v = classify(
      [...pairedRun(MINIMUM_FIRINGS), line(SHADOW_LINES.modUnheld, "odd")],
      { exclusions: [{ name: "odd ones", appliesTo: (f) => f.id === "odd" }] },
    );
    expect(v.verdict).toBe("PASS");
    expect(v.excluded).toEqual([
      { name: "odd ones", fires: [expect.objectContaining({ id: "odd" })] },
    ]);
    expect(v.fires.some((f) => f.id === "odd")).toBe(false);
  });

  it("refuses to call a zero-delay run a pass, however clean", () => {
    const v = classify(pairedRun(500), { owlt: value("s", 0) });
    expect(v.verdict).toBe("INCONCLUSIVE");
  });

  it("refuses a null delay, which is the mod's word for nothing measurable", () => {
    const v = classify(pairedRun(500), { owlt: null });
    expect(v.verdict).toBe("INCONCLUSIVE");
  });

  it("is not fooled by an empty log, which is the commonest way to see nothing", () => {
    expect(classify([]).verdict).toBe("INCONCLUSIVE");
  });

  it("ignores log lines that are not the shadow comparison's", () => {
    const v = classify([
      ...pairedRun(MINIMUM_FIRINGS),
      {
        level: "warn",
        message: "alarm-host: something else",
        timestamp: "2026-09-22T00:00:00.000Z",
      },
    ]);
    expect(v.verdict).toBe("PASS");
  });
});
