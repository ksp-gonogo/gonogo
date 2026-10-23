import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

afterEach(() => clearActionHandlers());

const GROUPS = Array.from({ length: 10 }, (_, i) => ({
  index: i + 1,
  name: `AG${i + 1}`,
  state: false,
}));

describe("ActionGroup: a toggle sent over a delayed link", () => {
  it("shows the command as pending on the rail while the shown state is still the old one", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 1000, suspendFrames: true });
    fixture.transport.holdCommands();
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ag-light" }}>
          <ActionGroupComponent
            config={{ actionGroupId: "Light" }}
            id="ag-light"
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("comms.delay", { oneWaySeconds: 286, source: 1 });
      fixture.emit("vessel.control", {
        sas: false,
        sasMode: 0,
        rcs: false,
        gear: false,
        brakes: false,
        lights: true,
        throttle: 0,
        actionGroups: GROUPS,
      });
    });
    await screen.findByText("ON");

    act(() => {
      screen.getByRole("button", { name: "Toggle Light" }).click();
    });
    const [sent] = fixture.transport.sentCommands;
    act(() => {
      fixture.emit("system.uplink.pending", {
        pending: [
          {
            id: "engine-1",
            clientRequestId: sent.requestId,
            command: "vessel.control.setLights",
            label: "Toggle Light",
            topic: "",
            vantage: "ground:Kerbin: KSC",
            dispatchedAt: 1000,
            oneWaySeconds: 286,
          },
        ],
      });
    });

    expect(
      screen.getByRole("button", { name: "Toggle Light" }).textContent,
    ).toBe("ON · sent");
  });
});

/*
 * The rig's light toggle to a probe at Eeloo: sent at UT 350296488.3 over a
 * 286 s one-way delay, its reply due at 350297060.3, and the first frame
 * showing the new state landing at 350297068.3.
 */
const SENT_UT = 350296488.3;
const REPLY_DUE_UT = SENT_UT + 2 * 286;

function control(lights: boolean) {
  return {
    sas: false,
    sasMode: 0,
    rcs: false,
    gear: false,
    brakes: false,
    lights,
    throttle: 0,
    actionGroups: GROUPS,
  };
}

/** Mounts the Light toggle with the light on, presses it, and answers the press once its reply is due. */
async function pressAndAnswer() {
  const fixture = setupStreamFixture({
    pinnedUt: SENT_UT,
    suspendFrames: true,
  });
  fixture.transport.holdCommands();
  fixture.transport.setCommandHandler(() => ({ ok: true }));
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ag-confirm" }}>
        <ActionGroupComponent
          config={{ actionGroupId: "Light" }}
          id="ag-confirm"
          w={6}
          h={6}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  const at = at_(fixture);
  act(() => {
    at(SENT_UT, "comms.link", { connected: true });
    at(SENT_UT, "comms.delay", { oneWaySeconds: 286, source: 1 });
    at(SENT_UT, "vessel.control", control(true));
  });
  await screen.findByText("ON");
  act(() => {
    screen.getByRole("button", { name: "Toggle Light" }).click();
  });
  const [sent] = fixture.transport.sentCommands;
  act(() => {
    at(SENT_UT, "system.uplink.pending", {
      pending: [
        {
          id: "engine-1",
          clientRequestId: sent.requestId,
          command: "vessel.control.setLights",
          label: "Toggle Light",
          topic: "",
          vantage: "ground:Kerbin: KSC",
          dispatchedAt: SENT_UT,
          oneWaySeconds: 286,
        },
      ],
    });
  });
  await act(async () => {
    at(REPLY_DUE_UT + 0.3, "system.uplink.pending", { pending: [] });
    at(REPLY_DUE_UT + 0.3, "vessel.control", control(true));
    fixture.transport.answerHeldCommands();
  });
  return at;
}

/** Emits `payload` delivered at `ut`, which is what moves the clock a command is judged against. */
function at_(fixture: ReturnType<typeof setupStreamFixture>) {
  return (ut: number, topic: string, payload: unknown) => {
    fixture.scrubTo(ut);
    fixture.emit(topic, payload, { validAt: ut - 286, deliveredAt: ut });
  };
}

const toggleText = () =>
  screen.getByRole("button", { name: "Toggle Light" }).textContent;

describe("ActionGroup: a toggle the craft has answered", () => {
  it("reads as sent until the craft's telemetry shows the new state", async () => {
    const at = await pressAndAnswer();
    expect(toggleText()).toBe("ON · sent");

    act(() => {
      at(350297068.3, "vessel.control", control(false));
    });
    expect(toggleText()).toBe("OFF");
    await act(async () => {});
  });

  it("says the toggle is unconfirmed when the telemetry has not shown it a minute after the reply", async () => {
    const at = await pressAndAnswer();

    act(() => {
      at(REPLY_DUE_UT + 61, "vessel.control", control(true));
    });
    expect(toggleText()).toBe("ON · unconfirmed");
    await act(async () => {});
  });
});
