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
  linkSource: "vessel:v1",
  routeHome: true,
  ownPortState: undefined,
  targetVesselPersistentId: undefined,
  targetVesselName: undefined,
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
        "[trace] stage changed 3 -> 2 (7 parts, 3 lost)",
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
    expect(lines().map((l) => l[1])).toEqual(["[trace] parts lost 10 -> 8"]);
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
      ["[trace] comms link lost (Probe)", false],
      ["[trace] comms link regained (Probe)", true],
    ]);
  });

  it("logs a dock and an undock once each, naming the other vessel", () => {
    const { trace, lines } = setup();
    trace({ ...base, ownPortState: DockingPortState.Ready });
    const docked = {
      ...base,
      ownPortState: DockingPortState.Docked,
      targetVesselPersistentId: 42,
      targetVesselName: "Station",
    };
    trace(docked);
    trace(docked);
    trace({ ...base, ownPortState: undefined });
    trace({ ...base, ownPortState: undefined });
    expect(lines().map((l) => [l[1], l[2]])).toEqual([
      [
        "[trace] docked with Station",
        {
          vesselId: "v1",
          vesselName: "Probe",
          otherVesselName: "Station",
          otherVesselPersistentId: 42,
        },
      ],
      [
        "[trace] undocked from Station",
        {
          vesselId: "v1",
          vesselName: "Probe",
          otherVesselName: "Station",
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
      linkSource: "vessel:v2",
    });
    expect(lines()).toEqual([]);
  });

  it("logs nothing when the old craft's link reading trails the switch", () => {
    const { trace, lines } = setup();
    trace(base);
    const switched = { ...base, vesselId: "v2", vesselName: "MkI" };
    trace(switched);
    trace({ ...switched, linkConnected: false });
    trace({ ...switched, linkConnected: true, linkSource: "vessel:v2" });
    trace({ ...switched, linkConnected: true, linkSource: "vessel:v2" });
    expect(lines()).toEqual([]);
  });

  it("logs nothing when the new craft's link reading leads the switch", () => {
    const { trace, lines } = setup();
    trace(base);
    trace({ ...base, linkConnected: false, linkSource: "vessel:v2" });
    trace({
      ...base,
      vesselId: "v2",
      vesselName: "MkI",
      linkConnected: false,
      linkSource: "vessel:v2",
    });
    expect(lines()).toEqual([]);
  });

  it("logs a loss and a regain on the craft switched to", () => {
    const { trace, lines } = setup();
    trace(base);
    const switched = {
      ...base,
      vesselId: "v2",
      vesselName: "MkI",
      linkSource: "vessel:v2",
    };
    trace(switched);
    trace({ ...switched, linkConnected: false });
    trace({ ...switched, linkConnected: true });
    expect(lines().map((l) => l[1])).toEqual([
      "[trace] comms link lost (MkI)",
      "[trace] comms link regained (MkI)",
    ]);
  });

  it("logs link changes from a reading that names no craft", () => {
    const { trace, lines } = setup();
    trace({ ...base, linkSource: undefined });
    trace({ ...base, linkSource: undefined, linkConnected: false });
    expect(lines().map((l) => l[1])).toEqual([
      "[trace] comms link lost (Probe)",
    ]);
  });
});
