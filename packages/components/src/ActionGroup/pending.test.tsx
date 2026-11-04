import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectLiveRegionPrimed } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { SENT_FLASH_MS } from "../shared/toggleConfirmation";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ActionGroupComponent } from "./index";

afterEach(() => clearActionHandlers());

/** Waits out the moment a toggle reads "SENT" after a press, however soon the mod answers it. */
const afterSentFlash = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, SENT_FLASH_MS + 20));
  });

const GROUPS = Array.from({ length: 10 }, (_, i) => ({
  index: i + 1,
  name: `AG${i + 1}`,
  state: false,
}));

describe("ActionGroup: a toggle sent over a delayed link", () => {
  it("reads SENT until the mod accepts the press, then its state while the rail carries the command", async () => {
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
    ).toBe("SENT");

    act(() => {
      fixture.transport.emitRaw({
        type: "command-accepted",
        requestId: sent.requestId,
        oneWaySeconds: 286,
      });
    });
    // Answered at once, the press still reads SENT for a moment, then the button shows its state again.
    expect(
      screen.getByRole("button", { name: "Toggle Light" }).textContent,
    ).toBe("SENT");
    await afterSentFlash();
    expect(
      screen.getByRole("button", { name: "Toggle Light" }).textContent,
    ).toBe("ON");
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
  await afterSentFlash();
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
  it("shows the state its readings show, from the reply on", async () => {
    const at = await pressAndAnswer();
    expect(toggleText()).toBe("ON");

    act(() => {
      at(350297068.3, "vessel.control", control(false));
    });
    expect(toggleText()).toBe("OFF");
    await act(async () => {});
  });

  it("puts no word on the button when the readings have not shown it a minute after the reply", async () => {
    const at = await pressAndAnswer();

    act(() => {
      at(REPLY_DUE_UT + 61, "vessel.control", control(true));
    });
    expect(toggleText()).toBe("ON");
    await act(async () => {});
  });
});

describe("ActionGroup: a toggle held for a link", () => {
  it("wears the held mark, keeping its state, while the route has the command waiting at a relay", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 1000, suspendFrames: true });
    fixture.transport.holdCommands();
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ag-held" }}>
          <ActionGroupComponent
            config={{ actionGroupId: "Light" }}
            id="ag-held"
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("comms.delay", { oneWaySeconds: 27, source: 1 });
      fixture.emit("vessel.control", control(true));
    });
    await screen.findByText("ON");

    act(() => {
      screen.getByRole("button", { name: "Toggle Light" }).click();
    });
    const [sent] = fixture.transport.sentCommands;
    act(() => {
      fixture.transport.emitRaw({
        type: "command-accepted",
        requestId: sent.requestId,
        oneWaySeconds: 527,
        predictedReplyUt: 1554,
      });
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
            oneWaySeconds: 27,
            laneSeq: 1,
            craft: "vessel:abc",
            predictedHeldAt: "relay-1",
            predictedHeldUntilUt: 1500,
            predictedArrivalUt: 1527,
            predictedReplyUt: 1554,
          },
        ],
      });
    });

    await afterSentFlash();
    expect(toggleText()).toBe("ON, Light held until contact returns");
    expect(toggleText()).not.toContain("HELD");
    await act(async () => {});
  });

  it("wears the held mark for a command another screen of the centre sent", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 1000, suspendFrames: true });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ag-held-other" }}>
          <ActionGroupComponent
            config={{ actionGroupId: "Light" }}
            id="ag-held-other"
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("comms.delay", { oneWaySeconds: 27, source: 1 });
      fixture.emit("vessel.control", control(true));
    });
    await screen.findByText("ON");

    act(() => {
      fixture.emit("system.uplink.pending", {
        pending: [
          {
            id: "engine-9",
            clientRequestId: "station-ab12:c4",
            command: "vessel.control.setLights",
            label: "Toggle Light",
            topic: "",
            vantage: "ground:Kerbin: KSC",
            dispatchedAt: 1000,
            oneWaySeconds: 27,
            laneSeq: 1,
            craft: "vessel:abc",
            predictedHeldAt: "relay-1",
            predictedHeldUntilUt: 1500,
            predictedArrivalUt: 1527,
            predictedReplyUt: 1554,
          },
        ],
      });
    });

    expect(toggleText()).toBe("ON, Light held until contact returns");
    await act(async () => {});
  });
});

describe("ActionGroup: telling a screen reader a toggle is outstanding", () => {
  it("says so in a live region mounted before the press", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 1000, suspendFrames: true });
    fixture.transport.holdCommands();
    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ag-live" }}>
          <ActionGroupComponent
            config={{ actionGroupId: "Light" }}
            id="ag-live"
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("comms.delay", { oneWaySeconds: 286, source: 1 });
      fixture.emit("vessel.control", control(true));
    });
    await screen.findByText("ON");

    const regions = await expectLiveRegionPrimed(container, () => {
      screen.getByRole("button", { name: "Toggle Light" }).click();
      const [sent] = fixture.transport.sentCommands;
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
    expect(regions.map((r) => r.textContent)).toContain(
      "Light sent, not yet received",
    );
    await act(async () => {});
  });
});

describe("ActionGroup: a command predicted to have reached the craft", () => {
  it("shows the state it sets, marked modelled, until its reply, then the reading", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 1000, suspendFrames: true });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ag-modelled" }}>
          <ActionGroupComponent
            config={{ actionGroupId: "Light" }}
            id="ag-modelled"
            w={6}
            h={6}
          />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    const meta = (ut: number) => ({ validAt: ut - 27, deliveredAt: ut });
    act(() => {
      fixture.emit("comms.link", { connected: true }, meta(1000));
      fixture.emit("comms.delay", { oneWaySeconds: 27, source: 1 }, meta(1000));
      fixture.emit("vessel.control", control(true), meta(1000));
      // Another screen of the centre sent it.
      fixture.emit(
        "system.uplink.pending",
        {
          pending: [
            {
              id: "engine-1",
              clientRequestId: "station-ab12:c1",
              command: "vessel.control.setLights",
              label: "Toggle Light",
              topic: "",
              vantage: "ground:Kerbin: KSC",
              dispatchedAt: 1000,
              oneWaySeconds: 27,
            },
          ],
        },
        meta(1000),
      );
    });
    await screen.findByText("ON");

    act(() => {
      fixture.scrubTo(1028);
      fixture.emit("comms.link", { connected: true }, meta(1028));
    });
    expect(toggleText()).toMatch(/^OFF, Light shown as predicted/);

    act(() => {
      fixture.scrubTo(1055);
      fixture.emit("system.uplink.pending", { pending: [] }, meta(1055));
      fixture.emit("vessel.control", control(false), meta(1055));
    });
    expect(toggleText()).toBe("OFF");
    await act(async () => {});
  });
});
