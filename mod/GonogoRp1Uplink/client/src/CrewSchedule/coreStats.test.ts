import type { AnyContribution } from "@ksp-gonogo/sitrep-sdk";
import { getContributionsForSlot, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { crewCoreStats } from "./coreStats";

/* Real `Value`s, not bare magnitudes: the contract types every count as
   `Value<"count">`, and a fixture that hands over a number typechecks only
   because nothing on the read path minds. */
const PROGRAM = {
  retirementEnabled: true,
  crewRnREnabled: true,
  missionTrainingEnabled: true,
  courses: value("count", 3),
  coursesStarted: value("count", 3),
  crewInTraining: value("count", 4),
};

function crewRow(overrides: Record<string, unknown> = {}) {
  return { name: "Wernher Kerman", ...overrides };
}

describe("crewCoreStats", () => {
  it("quotes the crew a mission cannot draw on, and what they are on", () => {
    const [inTraining] = crewCoreStats(PROGRAM, []);

    expect(inTraining?.label).toBe("In Training");
    // A `Value`, not a formatted number: the host draws it through its own
    // `Unit` so a contributed figure ladders its unit like every other reading.
    expect(inTraining?.value?.magnitude).toBe(4);
    expect(inTraining?.value?.unit).toBe("count");
    expect(inTraining?.detail).toBe("3 courses");
  });

  /**
   * RP-1 lets a course sit enrolled and unstarted indefinitely, so the two
   * counts differ on a real career and the difference is what says whether the
   * crew on them are becoming available on any schedule at all.
   */
  it("calls out the courses nobody has started", () => {
    const [inTraining] = crewCoreStats(
      {
        ...PROGRAM,
        courses: value("count", 3),
        coursesStarted: value("count", 1),
      },
      [],
    );

    expect(inTraining?.detail).toBe("3 courses · 2 not started");
  });

  it("counts the kerbals whose mission training is running out", () => {
    const stats = crewCoreStats(PROGRAM, [
      crewRow({ nextTrainingExpiryUt: value("ut", 9_000_000) }),
      crewRow({
        name: "Nedcas Kerman",
        nextTrainingExpiryUt: value("ut", 12_000_000),
      }),
      crewRow({ name: "Valentina Kerman" }),
    ]);
    const lapsing = stats.find((s) => s.id === "training-lapsing");

    expect(lapsing?.label).toBe("Training Lapsing");
    expect(lapsing?.value?.magnitude).toBe(2);
    expect(lapsing?.tone).toBe("warn");
  });

  /** A permanent amber zero is an alarm about nothing. */
  it("leaves a lapse count of zero untoned", () => {
    const stats = crewCoreStats(PROGRAM, [crewRow()]);
    const lapsing = stats.find((s) => s.id === "training-lapsing");

    expect(lapsing?.value?.magnitude).toBe(0);
    expect(lapsing?.tone).toBe("neutral");
  });

  /**
   * The setting is HONOURED, not reported: RP-1 stops checking mission training
   * entirely, so a count there is a figure about a mechanic nobody is running.
   * Absent, not zero.
   */
  it("says nothing about lapses on a save with mission training off", () => {
    const stats = crewCoreStats({ ...PROGRAM, missionTrainingEnabled: false }, [
      crewRow({ nextTrainingExpiryUt: value("ut", 9_000_000) }),
    ]);

    expect(stats.map((s) => s.id)).not.toContain("training-lapsing");
    // The in-training cell survives: a proficiency runs regardless.
    expect(stats.map((s) => s.id)).toContain("in-training");
  });

  /**
   * An unread roster is not a career with nothing lapsing. An empty crew array
   * IS that career and answers zero; an absent one has no answer to give.
   */
  it("draws no lapse cell at all while the roster is unread", () => {
    const stats = crewCoreStats(PROGRAM, undefined);
    expect(stats.map((s) => s.id)).not.toContain("training-lapsing");
  });

  /** A figure nobody sent is not a zero. */
  it("draws no in-training cell while the count is unread", () => {
    const stats = crewCoreStats({ ...PROGRAM, crewInTraining: undefined }, [
      crewRow(),
    ]);
    expect(stats.map((s) => s.id)).not.toContain("in-training");
  });

  it("registers itself into the Astronaut Complex's core-stat strip", () => {
    const ids = getContributionsForSlot("astronaut-complex.readouts").map(
      (c: AnyContribution) => c.id,
    );
    // Namespaced by the client handle, which is what stops two Uplinks
    // colliding on an id somebody picked independently.
    expect(ids).toContain("rp1:crew-core-stats");
  });
});
