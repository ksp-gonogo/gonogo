import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { Button } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { useNodeCommands } from "./useNodeCommands";
import { usePlan } from "./usePlan";
import type { PlannerInputs } from "./usePlannerInputs";
import { usePlannerTelemetry } from "./usePlannerTelemetry";

const UT_NOW = 1_000_000;

const INPUTS: PlannerInputs = {
  preset: "custom-ut",
  prograde: 10,
  normal: 0,
  radial: 0,
  burnInSeconds: 1_000,
  utMode: "relative",
  burnAtUT: 0,
  targetInclination: 0,
  targetAltitudeKm: 100,
  standoffMeters: 500,
  captureAltitudeKm: null,
  captureCircularise: true,
  transferBody: "",
};

function Harness({ out }: { out: { error: string | null } }) {
  const telemetry = usePlannerTelemetry();
  const { plan } = usePlan(INPUTS, telemetry);
  const commands = useNodeCommands([], plan, telemetry.burnContext);
  out.error = commands.error;
  return commands.commitCommand === null ? null : (
    <Button command={commands.commitCommand}>Add node</Button>
  );
}

const meta = { validAt: UT_NOW, deliveredAt: UT_NOW };

/** A planner on the first vessel whose Add node press has been refused. */
async function refusedPlanner() {
  const fixture = setupStreamFixture({ suspendFrames: true });
  fixture.transport.setCommandHandler(() => {
    throw Object.assign(new Error("refused"), { code: "notUnlocked" });
  });
  const out = { error: null as string | null };
  render(
    <fixture.Provider>
      <Harness out={out} />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("vessel.identity", { vesselId: "mk1" }, meta);
    fixture.emit(
      "trackingStation.bodies",
      { bodies: [{ index: 1, name: "Kerbin", radius: 600_000 }] },
      meta,
    );
    fixture.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: 700_000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: UT_NOW,
        mu: 3.5316e12,
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
      },
      meta,
    );
    fixture.emitFrame();
  });
  fireEvent.click(await screen.findByRole("button", { name: /Add node/ }));
  await waitFor(() => expect(out.error).not.toBeNull());
  return { fixture, out };
}

describe("the planner's refusal line", () => {
  it("is gone once a game load starts a new timeline", async () => {
    const { fixture, out } = await refusedPlanner();
    act(() => {
      fixture.store.clock.observeSample(10, 10, 1);
      fixture.emitFrame();
    });
    await waitFor(() => expect(out.error).toBeNull());
  });

  it("is gone once another vessel is active", async () => {
    const { fixture, out } = await refusedPlanner();
    act(() => {
      fixture.emit("vessel.identity", { vesselId: "mk1" }, meta);
      fixture.emitFrame();
    });
    expect(out.error).not.toBeNull();
    act(() => {
      fixture.emit("vessel.identity", { vesselId: "mun-probe" }, meta);
      fixture.emitFrame();
    });
    await waitFor(() => expect(out.error).toBeNull());
  });
});
