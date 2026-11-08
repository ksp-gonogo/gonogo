import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { openSections } from "../test/openSections";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

afterEach(() => clearActionHandlers());

const T0 = 1000;
const ONE_WAY = 27;
const THROTTLE = "vessel.control.setThrottle";

let fixture: StreamFixture;

function mount() {
  fixture = setupStreamFixture({ pinnedUt: T0, suspendFrames: true });
  fixture.transport.setCommandHandler(() => ({ ok: true }));
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "nav-thr" }}>
        <NavballComponent
          config={{ controlMode: true }}
          id="nav-thr"
          w={10}
          h={21}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  openSections();
  act(() => {
    fixture.emit(
      "comms.link",
      { connected: true },
      { validAt: T0 - ONE_WAY, deliveredAt: T0 },
    );
    fixture.emit("comms.delay", { oneWaySeconds: ONE_WAY, source: 1 });
    craftReports(0);
  });
}

/** The craft's throttle as it reaches the centre at `ut`, a one-way delay after the craft read it. */
function craftReports(throttle: number, ut = T0) {
  fixture.emit(
    "vessel.control",
    { sas: false, rcs: false, throttle },
    { validAt: ut - ONE_WAY, deliveredAt: ut },
  );
}

/** A throttle input queued at the centre by another screen, at `atUt`. */
function queueFromElsewhere(value: number, atUt: number) {
  act(() => {
    fixture.emit("system.uplink.pending", {
      pending: [
        {
          id: "engine-9",
          clientRequestId: "station-ab12:c1",
          command: THROTTLE,
          label: "Throttle",
          topic: "",
          vantage: "ground:Kerbin: KSC",
          dispatchedAt: atUt,
          oneWaySeconds: ONE_WAY,
          commandedValue: value,
        },
      ],
    });
  });
}

const press = (name: string) =>
  act(() => {
    screen.getByRole("button", { name }).click();
  });

const slider = () => screen.getByRole("slider", { name: "Throttle" });

/** The modelled mark on the throttle track: where the craft is expected to be now, while that is not the command. */
const expectedMark = () =>
  slider().parentElement?.querySelector('[data-role="expected"]') ?? null;

/** The value of the last throttle input this screen sent. */
function lastSent(): number | undefined {
  const args = fixture.transport.sentCommands
    .filter((c) => c.command === THROTTLE)
    .at(-1)?.args;
  if (typeof args !== "object" || args === null || !("value" in args)) {
    return undefined;
  }
  return typeof args.value === "number" ? args.value : undefined;
}

const sentCount = () =>
  fixture.transport.sentCommands.filter((c) => c.command === THROTTLE).length;

describe("Navball throttle under signal delay", () => {
  it("draws a command still on its way the same on every screen of the centre", async () => {
    mount();
    queueFromElsewhere(0.5, T0);
    expect(slider()).toHaveValue("0.5");
    expect(expectedMark()).not.toBeNull();
    await act(async () => {});
  });

  it("marks the craft expected at an older command that has reached it while a newer one travels", async () => {
    mount();
    act(() => {
      fixture.emit("system.uplink.pending", {
        pending: [
          {
            id: "e1",
            clientRequestId: "station-ab12:c1",
            command: THROTTLE,
            label: "Throttle",
            topic: "",
            vantage: "ground:Kerbin: KSC",
            dispatchedAt: T0,
            oneWaySeconds: ONE_WAY,
            commandedValue: 1,
          },
          {
            id: "e2",
            clientRequestId: "main:c2",
            command: THROTTLE,
            label: "Throttle",
            topic: "",
            vantage: "ground:Kerbin: KSC",
            dispatchedAt: T0 + 5,
            oneWaySeconds: ONE_WAY,
            commandedValue: 0,
          },
        ],
      });
      fixture.scrubTo(T0 + ONE_WAY + 1);
      craftReports(0, T0 + ONE_WAY + 1);
    });
    expect(slider()).toHaveValue("0");
    const mark = expectedMark() as HTMLElement | null;
    expect(mark?.style.left).toContain("calc(8px + 1 *");
    await act(async () => {});
  });

  it("shows the command on the slider, with the craft's expected throttle marked until the craft reports the command", async () => {
    mount();
    press("FULL");
    await waitFor(() => expect(lastSent()).toBe(1));
    expect(slider()).toHaveValue("1");
    expect(expectedMark()).not.toBeNull();

    act(() => craftReports(1));
    expect(slider()).toHaveValue("1");
    expect(expectedMark()).toBeNull();
  });

  it("steps from the input still on its way, not from the craft's reading", async () => {
    mount();
    press("FULL");
    await waitFor(() => expect(lastSent()).toBe(1));
    press("−10%");
    await waitFor(() => expect(lastSent()).toBeCloseTo(0.9));
  });

  it("steps from another screen's input on its way", async () => {
    mount();
    queueFromElsewhere(0.2, T0 - 1);
    expect(slider()).toHaveValue("0.2");
    press("+10%");
    await waitFor(() => expect(lastSent()).toBeCloseTo(0.3));
    expect(slider()).toHaveValue("0.3");
  });

  it("follows another screen's override once the craft reports it, and sends the same press again", async () => {
    mount();
    press("FULL");
    await waitFor(() => expect(lastSent()).toBe(1));

    act(() => fixture.scrubTo(T0 + 5));
    queueFromElsewhere(0, T0 + 5);
    act(() => {
      fixture.scrubTo(T0 + 70);
      fixture.emit("system.uplink.pending", { pending: [] });
      craftReports(0, T0 + 70);
    });
    expect(slider()).toHaveValue("0");

    const before = sentCount();
    press("FULL");
    await waitFor(() => expect(sentCount()).toBe(before + 1));
    expect(lastSent()).toBe(1);
  });

  it("steps from the craft's throttle once a round trip has passed without the input showing", async () => {
    mount();
    press("FULL");
    await waitFor(() => expect(lastSent()).toBe(1));
    act(() => {
      fixture.scrubTo(T0 + 2 * ONE_WAY + 5);
      craftReports(0, T0 + 2 * ONE_WAY + 5);
    });
    press("+10%");
    await waitFor(() => expect(lastSent()).toBeCloseTo(0.1));
  });

  it("follows the craft again after the game clock goes back to a quickload", async () => {
    mount();
    press("FULL");
    await waitFor(() => expect(lastSent()).toBe(1));
    act(() => {
      fixture.scrubTo(T0 - 100);
      craftReports(0, T0 - 100);
    });
    expect(slider()).toHaveValue("0");
    press("+10%");
    await waitFor(() => expect(lastSent()).toBeCloseTo(0.1));
  });
});
