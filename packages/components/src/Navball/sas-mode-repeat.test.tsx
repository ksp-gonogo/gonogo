import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
} from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

afterEach(() => clearActionHandlers());

const SENT_UT = 1000;
const ONE_WAY = 27;
const INSTANCE = "nav-sas-mode";

async function mount() {
  const fixture = setupStreamFixture({
    pinnedUt: SENT_UT,
    suspendFrames: true,
  });
  fixture.transport.holdCommands();
  fixture.transport.setCommandHandler(() => ({ ok: true }));
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: INSTANCE }}>
        <NavballComponent config={{}} id={INSTANCE} w={10} h={21} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("comms.link", { connected: true });
    fixture.emit("comms.delay", { oneWaySeconds: ONE_WAY, source: 1 });
    fixture.emit("vessel.control", {
      sas: true,
      sasMode: 0,
      rcs: false,
      precisionControl: false,
      gear: false,
      brakes: false,
      lights: false,
      throttle: 0,
    });
  });
  await screen.findByRole("button", { name: /^SAS/ });
  return fixture;
}

const press = (action: string) =>
  act(() => {
    dispatchAction(INSTANCE, action, { kind: "button", value: true });
  });

/** Puts the latest command sent on the centre's queue, as the mod does once it has accepted it. */
function queueLatest(fixture: StreamFixture, id: number) {
  const entries = fixture.transport.sentCommands.map((sent, i) => ({
    id: `engine-${i + 1}`,
    clientRequestId: sent.requestId,
    command: sent.command,
    label: sent.label ?? "",
    topic: "",
    vantage: "ground:Kerbin: KSC",
    dispatchedAt: SENT_UT,
    oneWaySeconds: ONE_WAY,
  }));
  act(() => {
    fixture.emit("system.uplink.pending", { pending: entries.slice(0, id) });
  });
}

const sent = (fixture: StreamFixture, command: string) =>
  fixture.transport.sentCommands.filter((c) => c.command === command);

describe("Navball SAS commands already on their way", () => {
  it("sends a SAS mode once however often its input is pressed before it arrives", async () => {
    const fixture = await mount();
    press("sas-prograde");
    queueLatest(fixture, 1);
    press("sas-prograde");
    press("sas-prograde");

    expect(sent(fixture, "vessel.control.setSasMode")).toHaveLength(1);
    await act(async () => {});
  });

  it("still sends a different mode while the first is on its way", async () => {
    const fixture = await mount();
    press("sas-prograde");
    queueLatest(fixture, 1);
    press("sas-retrograde");

    expect(sent(fixture, "vessel.control.setSasMode")).toHaveLength(2);
    await act(async () => {});
  });

  it("does not send Stability Assist again for a second kill-rotation while the first is on its way", async () => {
    const fixture = await mount();
    press("kill-rotation");
    queueLatest(fixture, 2);
    press("kill-rotation");

    expect(sent(fixture, "vessel.control.setSasMode")).toHaveLength(1);
    expect(sent(fixture, "vessel.control.setSas")).toHaveLength(0);
    await act(async () => {});
  });
});
