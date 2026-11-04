import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { SENT_FLASH_MS } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

afterEach(() => clearActionHandlers());

/** Waits out the moment a toggle reads "SENT" after a press, however soon the mod answers it. */
const afterSentFlash = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, SENT_FLASH_MS + 20));
  });

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

let view: ReturnType<typeof render>;

async function mount() {
  const fixture = setupStreamFixture({
    pinnedUt: SENT_UT,
    suspendFrames: true,
  });
  fixture.transport.holdCommands();
  fixture.transport.setCommandHandler(() => ({ ok: true }));
  view = render(
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

function pressRcs(
  fixture: StreamFixture,
  over: Record<string, unknown> = {},
  accepted = false,
) {
  act(() => {
    screen.getByRole("button", { name: /^RCS/ }).click();
  });
  const [sent] = fixture.transport.sentCommands;
  act(() => {
    if (accepted) {
      fixture.transport.emitRaw({
        type: "command-accepted",
        requestId: sent.requestId,
        oneWaySeconds: ONE_WAY,
      });
    }
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
  it("keeps an RCS toggle's sent mark through a resize to the tiny size and back", async () => {
    const fixture = await mount();
    pressRcs(fixture);
    expect(rcsText()).toBe("RCS SENT");

    const tile = (w: number, h: number) => (
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "nav-toggle" }}>
          <NavballComponent config={{}} id="nav-toggle" w={w} h={h} />
        </DashboardItemContext.Provider>
      </fixture.Provider>
    );
    view.rerender(tile(3, 3));
    expect(screen.queryByRole("button", { name: /^RCS/ })).toBeNull();
    view.rerender(tile(10, 21));
    expect(rcsText()).toBe("RCS SENT");
    await act(async () => {});
  });

  it("says an RCS toggle is sent until the mod answers the press", async () => {
    const fixture = await mount();
    expect(rcsText()).toBe("RCS OFF");

    pressRcs(fixture);
    expect(rcsText()).toBe("RCS SENT");
    // Past the moment every press shows, it still reads SENT: the mod has not answered.
    await afterSentFlash();
    expect(rcsText()).toBe("RCS SENT");

    act(() => {
      const [sent] = fixture.transport.sentCommands;
      fixture.transport.emitRaw({
        type: "command-accepted",
        requestId: sent.requestId,
        oneWaySeconds: ONE_WAY,
      });
    });
    expect(rcsText()).toBe("RCS OFF");

    await act(async () => {
      fixture.transport.answerHeldCommands();
      fixture.emit("system.uplink.pending", { pending: [] });
      fixture.emit("vessel.control", control(true));
    });
    expect(rcsText()).toBe("RCS ON");
    await act(async () => {});
  });

  it("sends the opposite of the first press, not of the stale reading, on a second press before the first is confirmed", async () => {
    const fixture = await mount();
    expect(rcsText()).toBe("RCS OFF");

    pressRcs(fixture);
    act(() => {
      screen.getByRole("button", { name: /^RCS/ }).click();
    });

    expect(
      fixture.transport.sentCommands.map((c) => [c.command, c.args]),
    ).toEqual([
      ["vessel.control.setRcs", { enabled: true }],
      ["vessel.control.setRcs", { enabled: false }],
    ]);
    await act(async () => {});
  });

  it("sends the opposite of the first press on a second press while the first travels, accepted by the mod", async () => {
    const fixture = await mount();

    pressRcs(fixture, {}, true);
    await afterSentFlash();
    // The button shows the stale reading while the press travels; the rail carries it.
    expect(rcsText()).toBe("RCS OFF");
    act(() => {
      screen.getByRole("button", { name: /^RCS/ }).click();
    });

    expect(
      fixture.transport.sentCommands.map((c) => [c.command, c.args]),
    ).toEqual([
      ["vessel.control.setRcs", { enabled: true }],
      ["vessel.control.setRcs", { enabled: false }],
    ]);
    await act(async () => {});
  });

  it("wears the held mark on an RCS toggle, keeping its state, while the route has it waiting for a link", async () => {
    const fixture = await mount();

    pressRcs(
      fixture,
      {
        laneSeq: 1,
        craft: "vessel:abc",
        predictedHeldAt: "relay-1",
        predictedHeldUntilUt: SENT_UT + 500,
        predictedArrivalUt: SENT_UT + 527,
        predictedReplyUt: SENT_UT + 554,
      },
      true,
    );
    await afterSentFlash();
    expect(rcsText()).toBe("RCS OFF, RCS held until contact returns");
    expect(rcsText()).not.toContain("HELD");
    await act(async () => {});
  });
});

describe("Navball toggles once a command is predicted to have reached the craft", () => {
  /** Moves the clock past the press's predicted arrival at the craft, its reply still on its way. */
  async function arrive(fixture: StreamFixture) {
    await act(async () => {
      const ut = SENT_UT + ONE_WAY + 1;
      fixture.scrubTo(ut);
      // A fresh link reading, as the stream sends each second, is what has the toggle look at the clock again.
      fixture.emit(
        "comms.link",
        { connected: true },
        { validAt: ut - ONE_WAY, deliveredAt: ut },
      );
    });
  }

  it("shows the state a command is predicted to have set, marked modelled, until its reply confirms it", async () => {
    const fixture = await mount();
    pressRcs(fixture, {}, true);
    await afterSentFlash();
    expect(rcsText()).toBe("RCS OFF");

    await arrive(fixture);
    expect(rcsText()).toMatch(/^RCS ON/);
    expect(screen.getByText(/shown as predicted/)).toBeTruthy();

    await act(async () => {
      fixture.transport.answerHeldCommands();
      fixture.emit("system.uplink.pending", { pending: [] });
      fixture.emit("vessel.control", control(true));
    });
    expect(rcsText()).toBe("RCS ON");
    expect(screen.queryByText(/shown as predicted/)).toBeNull();
    await act(async () => {});
  });

  it("goes back to the reading when the craft refuses the command", async () => {
    const fixture = await mount();
    fixture.transport.setCommandHandler(() => ({
      success: false,
      errorCode: "modeUnavailable",
    }));
    pressRcs(fixture, {}, true);
    await afterSentFlash();
    await arrive(fixture);
    expect(rcsText()).toMatch(/^RCS ON/);

    await act(async () => {
      fixture.transport.answerHeldCommands();
      fixture.emit("system.uplink.pending", { pending: [] });
    });
    expect(rcsText()).toBe("RCS OFF");
    await act(async () => {});
  });

  it("presses to the opposite of the state predicted for another screen's command", async () => {
    const fixture = await mount();
    act(() => {
      fixture.emit("system.uplink.pending", {
        pending: [
          {
            id: "engine-1",
            clientRequestId: "station-ab12:c1",
            command: "vessel.control.setRcs",
            label: "Toggle RCS",
            topic: "",
            vantage: "ground:Kerbin: KSC",
            dispatchedAt: SENT_UT,
            oneWaySeconds: ONE_WAY,
          },
        ],
      });
    });
    expect(rcsText()).toBe("RCS OFF");
    await arrive(fixture);
    expect(rcsText()).toMatch(/^RCS ON/);
    act(() => {
      screen.getByRole("button", { name: /^RCS/ }).click();
    });
    expect(fixture.transport.sentCommands.map((c) => c.args)).toEqual([
      { enabled: false },
    ]);
    await act(async () => {});
  });
});
