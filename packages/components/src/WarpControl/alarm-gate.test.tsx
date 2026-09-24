import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
} from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AlarmsLauncher,
  AlarmsLauncherProvider,
  type PendingAlarmSummary,
} from "../shared/AlarmsLauncher";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { delayRequiringAlarm, WarpControlComponent } from "./index";

beforeEach(() => {
  clearActionHandlers();
});

const INSTANCE = "warp-gate";
const VIEW_UT = 5_000_000;
const HIGHER_RUNGS = ["5×", "10×", "50×", "100×", "1k×", "10k×", "100k×"];

interface MountOptions {
  oneWaySeconds?: number | null;
  scene?: string;
  pending?: readonly PendingAlarmSummary[];
  config?: { requireAlarmUnderDelay?: boolean };
  launcher?: AlarmsLauncher;
  warpIndex?: number;
}

async function mount(opts: MountOptions) {
  const fixture = setupStreamFixture({
    carriedChannels: [
      "time.warp",
      "time.setWarpIndex",
      "comms.delay",
      "spaceCenter.scene",
    ],
    pinnedUt: VIEW_UT,
    suspendFrames: true,
  });
  const commandHandler = vi.fn(() => ({ ok: true }));
  fixture.transport.setCommandHandler(commandHandler);

  const widget = (
    <DashboardItemContext.Provider value={{ instanceId: INSTANCE }}>
      <WarpControlComponent
        id={INSTANCE}
        w={6}
        h={5}
        config={opts.config ?? {}}
      />
    </DashboardItemContext.Provider>
  );
  const withAlarms = (children: ReactNode) =>
    opts.pending === undefined ? (
      children
    ) : (
      <AlarmsLauncherProvider
        launcher={opts.launcher ?? (() => {})}
        pending={opts.pending}
      >
        {children}
      </AlarmsLauncherProvider>
    );

  const { container } = render(
    <fixture.Provider>{withAlarms(widget)}</fixture.Provider>,
  );

  const index = opts.warpIndex ?? 0;
  act(() => {
    fixture.emit("time.warp", {
      warpRate: [1, 5, 10, 50, 100][index] ?? 1,
      warpRateIndex: index,
      warpMode: 0,
      paused: false,
    });
    fixture.emit("spaceCenter.scene", { scene: opts.scene ?? "Flight" });
    if (opts.oneWaySeconds !== undefined) {
      fixture.emit("comms.delay", { oneWaySeconds: opts.oneWaySeconds });
    }
  });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", {
          name: ["1×", "5×", "10×", "50×", "100×"][index],
        })
        .getAttribute("aria-pressed"),
    ).toBe("true"),
  );
  return { fixture, commandHandler, container };
}

function higherRungsDisabled(): boolean[] {
  return HIGHER_RUNGS.map(
    (name) =>
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
  );
}

describe("delayRequiringAlarm", () => {
  const delay = (oneWaySeconds: number | null) => ({
    oneWaySeconds: oneWaySeconds === null ? null : value("s", oneWaySeconds),
  });

  it("asks nothing at or under 5 s", () => {
    expect(delayRequiringAlarm(delay(0))).toBeNull();
    expect(delayRequiringAlarm(delay(5))).toBeNull();
  });

  it("asks for an alarm above 5 s", () => {
    expect(delayRequiringAlarm(delay(5.5))).toBe("delay");
  });

  it("treats a craft with no path home as the far end of the same condition", () => {
    expect(delayRequiringAlarm(delay(null))).toBe("no-path");
  });

  it("asks nothing of a delay it has not been told", () => {
    expect(delayRequiringAlarm(undefined)).toBeNull();
  });
});

describe("WarpControl: an alarm is required to warp under delay", () => {
  it("holds warp at its rate with no alarm set, and states the condition", async () => {
    await mount({ oneWaySeconds: 742, pending: [] });

    expect(higherRungsDisabled().every(Boolean)).toBe(true);
    expect(
      (screen.getByRole("button", { name: "1×" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      screen.getByRole("button", { name: "Set alarm to warp" }),
    ).toBeTruthy();
  });

  it("still lets warp come down from a rate it was already at", async () => {
    await mount({ oneWaySeconds: 742, pending: [], warpIndex: 3 });

    for (const name of ["1×", "5×", "10×", "50×"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(false);
    }
    for (const name of ["100×", "1k×", "10k×", "100k×"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
  });

  it("opens the alarms modal from the condition", async () => {
    const launcher = vi.fn();
    await mount({ oneWaySeconds: 742, pending: [], launcher });

    await userEvent.click(
      screen.getByRole("button", { name: "Set alarm to warp" }),
    );

    expect(launcher).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a mapped warp-up input while held", async () => {
    const { commandHandler } = await mount({ oneWaySeconds: 742, pending: [] });

    act(() => {
      dispatchAction(INSTANCE, "stepUp", { kind: "button", value: true });
    });
    act(() => {
      dispatchAction(INSTANCE, "stop", { kind: "button", value: true });
    });

    await waitFor(() =>
      expect(commandHandler).toHaveBeenCalledWith("time.setWarpIndex", {
        index: 0,
      }),
    );
    expect(commandHandler).toHaveBeenCalledTimes(1);
  });

  it("keeps holding on the last delay it was told while the link is quiet", async () => {
    const { fixture } = await mount({ oneWaySeconds: 742, pending: [] });

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    expect(higherRungsDisabled().every(Boolean)).toBe(true);
  });

  it("holds warp for a craft with no path home", async () => {
    await mount({ oneWaySeconds: null, pending: [] });

    expect(higherRungsDisabled().every(Boolean)).toBe(true);
    expect(screen.getByText("No path")).toBeTruthy();
  });

  it("frees the controls once any alarm is set, and shows the next one", async () => {
    await mount({
      oneWaySeconds: 742,
      pending: [
        { id: "pe", name: "Duna periapsis", ut: VIEW_UT + 5400 },
        { id: "soi", name: "Ike SOI exit", ut: VIEW_UT + 20_000 },
      ],
    });

    expect(higherRungsDisabled().some(Boolean)).toBe(false);
    expect(
      screen.queryByRole("button", { name: "Set alarm to warp" }),
    ).toBeNull();
    const next = screen.getByLabelText("Next alarm");
    expect(next.textContent).toContain("Duna periapsis");
    expect(next.textContent).toContain("1h 30min");
    expect(screen.queryByText("Ike SOI exit")).toBeNull();
  });

  it("shows an alarm with no instant by name alone", async () => {
    await mount({
      oneWaySeconds: 742,
      pending: [{ id: "alt", name: "Below 70 km", ut: null }],
    });

    expect(higherRungsDisabled().some(Boolean)).toBe(false);
    expect(screen.getByLabelText("Next alarm").textContent).toBe("Below 70 km");
  });

  it("asks nothing at 5 s or under", async () => {
    await mount({ oneWaySeconds: 3, pending: [] });

    expect(higherRungsDisabled().some(Boolean)).toBe(false);
    expect(
      screen.queryByRole("button", { name: "Set alarm to warp" }),
    ).toBeNull();
  });

  it("asks nothing with the setting off", async () => {
    await mount({
      oneWaySeconds: 742,
      pending: [],
      config: { requireAlarmUnderDelay: false },
    });

    expect(higherRungsDisabled().some(Boolean)).toBe(false);
  });

  it("asks nothing outside flight, where there is no craft to be delayed to", async () => {
    await mount({ oneWaySeconds: 742, pending: [], scene: "SpaceCenter" });

    expect(higherRungsDisabled().some(Boolean)).toBe(false);
  });

  it("asks nothing of a tree with no alarm pipeline to satisfy it from", async () => {
    await mount({ oneWaySeconds: 742 });

    expect(higherRungsDisabled().some(Boolean)).toBe(false);
  });

  it("has no accessibility violations while held", async () => {
    const { container } = await mount({ oneWaySeconds: 742, pending: [] });
    await expectNoA11yViolations(container);
  });
});
