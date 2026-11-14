import { ConsoleLogger } from "@ksp-gonogo/logger";
import { DockingPortState } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { playtestTracer, type TraceSnapshot } from "./playtestTrace";

const base: TraceSnapshot = {
  vesselId: "v1",
  vesselName: "Probe",
  currentStage: 3,
  partCount: 10,
  linkConnected: true,
  routeHome: true,
  ownPortState: undefined,
  targetVesselPersistentId: undefined,
};

function setup() {
  const logger = new ConsoleLogger({ enabled: true, persist: null });
  const trace = playtestTracer(logger.tag("trace"));
  const lines = () =>
    logger.getBuffer().map((e) => [e.level, e.message, e.context]);
  return { trace, lines };
}

describe("playtestTracer", () => {
  it("logs a stage once on the change and not on repeats", () => {
    const { trace, lines } = setup();
    trace(base);
    trace({ ...base, currentStage: 2, partCount: 7 });
    trace({ ...base, currentStage: 2, partCount: 7 });
    expect(lines()).toEqual([
      [
        "info",
        "[trace] stage changed",
        {
          vesselId: "v1",
          vesselName: "Probe",
          fromStage: 3,
          toStage: 2,
          partCount: 7,
          partsLost: 3,
        },
      ],
    ]);
  });

  it("logs lost parts without a stage change once", () => {
    const { trace, lines } = setup();
    trace(base);
    trace({ ...base, partCount: 8 });
    trace({ ...base, partCount: 8 });
    expect(lines().map((l) => l[1])).toEqual(["[trace] parts lost"]);
  });

  it("logs only the transitions of the comms link", () => {
    const { trace, lines } = setup();
    trace(base);
    trace({ ...base, linkConnected: false, routeHome: false });
    trace({ ...base, linkConnected: false, routeHome: false });
    trace({ ...base, linkConnected: undefined });
    trace({ ...base, linkConnected: true });
    trace({ ...base, linkConnected: true });
    expect(
      lines().map((l) => [l[1], (l[2] as { connected: boolean }).connected]),
    ).toEqual([
      ["[trace] comms link lost", false],
      ["[trace] comms link regained", true],
    ]);
  });

  it("logs a dock and an undock once each, naming the other vessel", () => {
    const { trace, lines } = setup();
    trace({ ...base, ownPortState: DockingPortState.Ready });
    const docked = {
      ...base,
      ownPortState: DockingPortState.Docked,
      targetVesselPersistentId: 42,
    };
    trace(docked);
    trace(docked);
    trace({ ...base, ownPortState: undefined });
    trace({ ...base, ownPortState: undefined });
    expect(lines().map((l) => [l[1], l[2]])).toEqual([
      [
        "[trace] docked",
        { vesselId: "v1", vesselName: "Probe", otherVesselPersistentId: 42 },
      ],
      [
        "[trace] undocked",
        {
          vesselId: "v1",
          vesselName: "Probe",
          otherVesselPersistentId: undefined,
        },
      ],
    ]);
  });

  it("logs nothing when the active vessel changes", () => {
    const { trace, lines } = setup();
    trace(base);
    trace({
      ...base,
      vesselId: "v2",
      currentStage: 1,
      partCount: 2,
      linkConnected: false,
    });
    expect(lines()).toEqual([]);
  });
});
