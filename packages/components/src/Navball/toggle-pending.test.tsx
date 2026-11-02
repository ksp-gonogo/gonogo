import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
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

function control(rcs: boolean) {
  return {
    sas: false,
    sasMode: 0,
    rcs,
    precisionControl: false,
    gear: false,
    brakes: false,
    lights: false,
    throttle: 0,
  };
}

async function mount() {
  const fixture = setupStreamFixture({
    pinnedUt: SENT_UT,
    suspendFrames: true,
  });
  fixture.transport.holdCommands();
  fixture.transport.setCommandHandler(() => ({ ok: true }));
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "nav-toggle" }}>
        <NavballComponent config={{}} id="nav-toggle" w={10} h={21} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("comms.link", { connected: true });
    fixture.emit("comms.delay", { oneWaySeconds: ONE_WAY, source: 1 });
    fixture.emit("vessel.control", control(false));
  });
  await screen.findByRole("button", { name: /^RCS/ });
  return fixture;
}

function pressRcs(fixture: StreamFixture, over: Record<string, unknown> = {}) {
  act(() => {
    screen.getByRole("button", { name: /^RCS/ }).click();
  });
  const [sent] = fixture.transport.sentCommands;
  act(() => {
    fixture.emit("system.uplink.pending", {
      pending: [
        {
          id: "engine-1",
          clientRequestId: sent.requestId,
          command: "vessel.control.setRcs",
          label: "Toggle RCS",
          topic: "",
          vantage: "ground:Kerbin: KSC",
          dispatchedAt: SENT_UT,
          oneWaySeconds: ONE_WAY,
          ...over,
        },
      ],
    });
  });
}

const rcsText = () => screen.getByRole("button", { name: /^RCS/ }).textContent;

describe("Navball toggles over a delayed link", () => {
  it("says an RCS toggle is sent while the shown state is still the old one", async () => {
    const fixture = await mount();
    expect(rcsText()).toBe("RCS OFF");

    pressRcs(fixture);
    expect(rcsText()).toBe("RCS SENT");

    await act(async () => {
      fixture.transport.answerHeldCommands();
      fixture.emit("system.uplink.pending", { pending: [] });
      fixture.emit("vessel.control", control(true));
    });
    expect(rcsText()).toBe("RCS ON");
    await act(async () => {});
  });

  it("wears the held mark on an RCS toggle, keeping its state, while the route has it waiting for a link", async () => {
    const fixture = await mount();

    pressRcs(fixture, {
      laneSeq: 1,
      craft: "vessel:abc",
      predictedHeldAt: "relay-1",
      predictedHeldUntilUt: SENT_UT + 500,
      predictedArrivalUt: SENT_UT + 527,
      predictedReplyUt: SENT_UT + 554,
    });
    expect(rcsText()).toBe("RCS OFF, RCS held until contact returns");
    expect(rcsText()).not.toContain("HELD");
    await act(async () => {});
  });
});
