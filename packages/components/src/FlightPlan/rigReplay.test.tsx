import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeAll, describe, expect, it } from "vitest";
import { rigFixture, startRigReplay } from "../test/replayRig";
import { FlightPlanComponent } from "./index";
import type { FlightPlan } from "./plan";
import { applyPlan, savePlan } from "./planStore";

/**
 * The Flight Plan played through the design video's flight off the Deck: a
 * scripted rocket launched due south from the pad, burned dry short of its
 * cutoff and hit the sea without its chute. The recording keeps the Topics the
 * tile reads, exactly as they arrived.
 *
 * Beside it are the `.craft` and the boot script it flew.
 */

const fixture = rigFixture("design-splash-flight");
const CRAFT = "f0cd3186-7857-4b60-a7c2-7f7627bd9ad2";

const plan: FlightPlan = {
  id: "splash-south",
  name: "Splash south",
  reserve: 0.1,
  steps: [
    { id: "s1", kind: "launch", inputs: { heading: 180 }, intents: [] },
    { id: "s2", kind: "land", inputs: { on: "Kerbin" }, intents: [] },
  ],
};

/** A frame's topic, valid-at time and altitude, where it carries them. */
function readFrame(raw: string): {
  topic: string | undefined;
  validAt: number | undefined;
  altitude: number | undefined;
} {
  const frame: unknown = JSON.parse(raw);
  if (typeof frame !== "object" || frame === null) {
    return { topic: undefined, validAt: undefined, altitude: undefined };
  }
  const topic = "topic" in frame ? frame.topic : undefined;
  const meta = "meta" in frame ? frame.meta : undefined;
  const payload = "payload" in frame ? frame.payload : undefined;
  const validAt =
    typeof meta === "object" && meta !== null && "validAt" in meta
      ? meta.validAt
      : undefined;
  const altitude =
    typeof payload === "object" && payload !== null && "altitudeAsl" in payload
      ? payload.altitudeAsl
      : undefined;
  return {
    topic: typeof topic === "string" ? topic : undefined,
    validAt: typeof validAt === "number" ? validAt : undefined,
    altitude: typeof altitude === "number" ? altitude : undefined,
  };
}

/** Seconds into the recording of the first `vessel.flight` frame at or above 10 km, the height a launch step clears. */
function clearedAt(): number {
  const frames = fixture.frames.map(readFrame);
  const start = frames[0]?.validAt ?? 0;
  const frame = frames.find(
    (f) =>
      f.topic === "vessel.flight" &&
      f.altitude !== undefined &&
      f.altitude >= 10_000,
  );
  if (frame?.validAt === undefined) throw new Error("never cleared");
  return frame.validAt - start;
}

const seconds: string[] = [];

beforeAll(async () => {
  savePlan(plan);
  applyPlan(CRAFT, plan.id);
  const replay = startRigReplay(fixture);
  const { container, unmount } = render(
    <replay.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "rig" }}>
        <FlightPlanComponent id="rig" h={12} />
      </DashboardItemContext.Provider>
    </replay.Provider>,
  );
  for (let second = 0; second <= Math.ceil(replay.duration); second++) {
    await act(async () => {
      replay.advanceTo(second);
    });
    seconds.push(visibleText(container));
  }
  unmount();
});

describe("FlightPlan through the design video's flight", () => {
  it("follows the plan applied to the craft from its first frame to impact", () => {
    const first = seconds.findIndex((t) => t.includes("Launch"));
    expect(first).toBeGreaterThan(-1);
    for (const text of seconds.slice(first, -1)) {
      expect(text).toContain("LandKerbin");
      expect(text).not.toContain("No plan applied");
    }
  });

  it("marks the launch done from the frame that clears 10 km, and not before", () => {
    const due = Math.ceil(clearedAt());
    expect(seconds[due - 1]).not.toContain("Done");
    expect(seconds[due]).toContain("Done");
  });

  it("never marks the landing done, since the craft hit the sea and never splashed down", () => {
    for (const text of seconds) {
      expect(text.split("Done").length - 1).toBeLessThanOrEqual(1);
    }
  });

  it("shows the Δv left falling to nothing once the tank burns dry", () => {
    const dry = seconds.findIndex((t) => t.includes("Left0 m/s"));
    expect(dry).toBeGreaterThan(Math.ceil(clearedAt()));
    expect(seconds[dry - 10]).not.toContain("Left0 m/s");
  });
});
