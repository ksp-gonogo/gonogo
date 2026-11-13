import { render, screen } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  AlarmBanner,
  AlarmsCancelledPill,
  SafetyMarginPill,
} from "./AlarmBanner";
import { AlarmHostProvider } from "./AlarmHostContext";
import { AlarmHostService } from "./AlarmHostService";
import type { Alarm, AlarmSnapshot } from "./types";

function timeAlarm(ut: number, state: Alarm["state"] = "pending"): Alarm {
  return {
    id: "a1",
    name: "Node burn",
    trigger: { kind: "time", ut, leadSeconds: 10 },
    state,
    createdBy: "main",
    createdAt: 0,
  };
}

function snapshotOf(alarms: Alarm[], ut: number | null): AlarmSnapshot {
  return {
    alarms,
    ut,
    warp: { index: 0, rate: 1, mode: "UNKNOWN" },
    unscheduledWarp: null,
    warpTo: null,
    warpSafetyMarginSeconds: 10,
  };
}

/**
 * A real service with no peer host, with the two methods the banner reads
 * pinned to a fixed snapshot.
 *
 * A real instance rather than an object literal cast through `unknown`: the
 * cast would keep compiling if the banner started reading a third method, and
 * would then fail at runtime instead of at the type level.
 */
function fakeHost(snapshot: AlarmSnapshot): AlarmHostService {
  const service = new AlarmHostService(null);
  service.snapshot = () => snapshot;
  service.subscribe = () => () => {};
  return service;
}

function renderBanner(snapshot: AlarmSnapshot) {
  return render(
    <AlarmHostProvider service={fakeHost(snapshot)}>
      <AlarmBanner />
    </AlarmHostProvider>,
  );
}

describe("AlarmBanner T-minus under signal delay", () => {
  it("counts down to the game's fire, which is a delay ahead of the view clock", () => {
    const fixture = setupStreamFixture({ delaySeconds: 10 });
    const { container } = render(
      <fixture.Provider>
        <AlarmHostProvider
          service={fakeHost(snapshotOf([timeAlarm(1070)], 1000))}
        >
          <AlarmBanner />
        </AlarmHostProvider>
      </fixture.Provider>,
    );
    expect(container.textContent).toContain("T−1min");
  });

  it("reads T = 0 when the game reaches the alarm's UT", () => {
    const fixture = setupStreamFixture({ delaySeconds: 10 });
    const { container } = render(
      <fixture.Provider>
        <AlarmHostProvider
          service={fakeHost(snapshotOf([timeAlarm(1070)], 1060))}
        >
          <AlarmBanner />
        </AlarmHostProvider>
      </fixture.Provider>,
    );
    expect(container.textContent).toContain("T = 0");
  });
});

describe("AlarmBanner T-minus", () => {
  it("counts down to a future time alarm on the GAME clock", () => {
    // 8100 game seconds: two hours and a quarter, the same ladder the kit walks for the `time` kind.
    const { container } = renderBanner(snapshotOf([timeAlarm(8100)], 0));
    expect(screen.getByText("Node burn")).toBeInTheDocument();
    expect(container.textContent).toContain("T−2h 15m");
  });

  it("counts up after the alarm's UT has passed", () => {
    const { container } = renderBanner(snapshotOf([timeAlarm(0)], 600));
    expect(container.textContent).toContain("T+10m");
  });

  it("shows T = 0 inside the three-second window either side", () => {
    const { container } = renderBanner(snapshotOf([timeAlarm(100)], 101));
    expect(container.textContent).toContain("T = 0");
  });

  it("shows T−? while the game clock is unknown", () => {
    const { container } = renderBanner(snapshotOf([timeAlarm(8100)], null));
    expect(container.textContent).toContain("T−?");
  });
});

/* The margin box is the operator's, and on a delayed craft the controller
   holds open more room than it asks for. A control silently overridden reads
   as a broken control, so the pill says what is actually in force. */
describe("AlarmBanner safety margin", () => {
  function warpingSnapshot(owltSeconds?: number): AlarmSnapshot {
    return {
      ...snapshotOf([timeAlarm(8100)], 0),
      warpTo: { alarmId: "a1", targetIndex: 4, targetRate: 100 },
      owltSeconds,
    };
  }

  it("names the light-time when it is the margin actually in force", () => {
    const { container } = render(
      <AlarmHostProvider service={fakeHost(warpingSnapshot(240))}>
        <SafetyMarginPill />
      </AlarmHostProvider>,
    );
    expect(container.textContent).toContain("light-time 4min in force");
  });

  it("CONTROL: says nothing about light-time when the setting is in force", () => {
    const { container } = render(
      <AlarmHostProvider service={fakeHost(warpingSnapshot())}>
        <SafetyMarginPill />
      </AlarmHostProvider>,
    );
    expect(container.textContent).not.toContain("light-time");
  });
});

describe("AlarmsCancelledPill", () => {
  it("says how many alarms a craft switch cancelled, and why, until acknowledged", async () => {
    const host = fakeHost({
      ...snapshotOf([], 0),
      alarmsCancelled: { count: 2 },
    });
    const acknowledge = vi.spyOn(host, "acknowledgeAlarmsCancelled");
    const { container } = render(
      <AlarmHostProvider service={host}>
        <AlarmsCancelledPill />
      </AlarmHostProvider>,
    );
    expect(container.textContent).toContain("Alarms cancelled");
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("active vessel changed");

    await userEvent.click(screen.getByRole("button", { name: "Ack" }));
    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it("CONTROL: renders nothing when nothing was cancelled", () => {
    const { container } = render(
      <AlarmHostProvider service={fakeHost(snapshotOf([], 0))}>
        <AlarmsCancelledPill />
      </AlarmHostProvider>,
    );
    expect(container.textContent).toBe("");
  });
});

describe("AlarmBanner on a fire", () => {
  it("states the facts of the fire beside the alarm", () => {
    const fired: Alarm = { ...timeAlarm(4000, "fired"), eventUT: 4000 };
    const { container } = renderBanner(snapshotOf([fired], 4300));
    expect(container.textContent).toContain("Warp stopped.");
  });
});

describe("AlarmBanner with an alarm the simulation refused to arm", () => {
  const refused: Alarm = {
    id: "refused-1",
    name: "Test RT-5",
    trigger: {
      kind: "contract-parameter",
      contractId: "42",
      parameterTitle: "Orbit the Mun",
      targetState: "Complete",
      sustainSeconds: 0,
    },
    state: "pending",
    createdBy: "main",
    createdAt: 0,
  };
  const refusal = "alarm.scet.arm requires argument actsOn and it was not sent";

  it("states the refusal and shows no next alarm for it", () => {
    renderBanner({
      ...snapshotOf([refused], 0),
      scetArmRefusals: { [refused.id]: refusal },
    });
    expect(screen.queryByText("Next alarm")).toBeNull();
    expect(screen.getByText("Not armed")).toBeInTheDocument();
    expect(screen.getByText(refusal)).toBeInTheDocument();
  });

  it("still shows the next alarm that was armed beside it", () => {
    renderBanner({
      ...snapshotOf([refused, timeAlarm(8100)], 0),
      scetArmRefusals: { [refused.id]: refusal },
    });
    expect(screen.getByText("Next alarm")).toBeInTheDocument();
    expect(screen.getByText("Node burn")).toBeInTheDocument();
    expect(screen.getByText(refusal)).toBeInTheDocument();
  });

  it("shows an alarm with no refusal against it as the next alarm", () => {
    renderBanner(snapshotOf([refused], 0));
    expect(screen.getByText("Next alarm")).toBeInTheDocument();
    expect(screen.queryByText("Not armed")).toBeNull();
  });
});

describe("the first-signal strip after a switch of craft", () => {
  const waiting = {
    vesselName: "Mun Probe",
    owltSeconds: 1_800,
    estimated: false,
  };

  it("names the craft and offers to warp to its first signal", async () => {
    const user = userEvent.setup();
    const service = fakeHost({
      ...snapshotOf([], 1_000),
      firstSignal: waiting,
    });
    const begin = vi.fn();
    service.beginWarpToFirstSignal = begin;
    render(
      <AlarmHostProvider service={service}>
        <AlarmBanner />
      </AlarmHostProvider>,
    );

    expect(screen.getByText("Mun Probe")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Warp to first signal/ }),
    );
    expect(begin).toHaveBeenCalledOnce();
  });

  async function tipFor(firstSignal: AlarmSnapshot["firstSignal"]) {
    const user = userEvent.setup();
    renderBanner({ ...snapshotOf([], 1_000), firstSignal });
    await user.tab();
    await user.tab();
    await user.hover(
      screen.getByRole("img", { name: "Why there is no data yet" }),
    );
    return screen.findByText(
      /^Right now Gonogo can't stream from other vessels in the background, so vessel data only started streaming at the moment of the switch, which will take .+ to arrive here\.$/,
    );
  }

  it("explains why there is no data yet, with the real delay in the app's own duration format and no tilde", async () => {
    const tip = await tipFor(waiting);
    expect(tip.textContent).toContain("which will take 30min to arrive");
  });

  it("marks an estimated delay with a leading tilde", async () => {
    const tip = await tipFor({ ...waiting, estimated: true });
    expect(tip.textContent).toContain("which will take ~30min to arrive");
  });

  it("says the figure is unknown the way the other banners do while there is no real delay and no estimate", async () => {
    const tip = await tipFor({
      vesselName: "Mun Probe",
      owltSeconds: null,
      estimated: false,
    });
    expect(tip.textContent).toContain(
      `which will take ${NULL_DISPLAY} to arrive`,
    );
  });

  it("offers a stop while the warp toward the first signal runs", () => {
    renderBanner({
      ...snapshotOf([], 1_000),
      firstSignal: waiting,
      warpTo: { alarmId: "first-signal", targetIndex: 2, targetRate: 100 },
    });
    expect(
      screen.getByRole("button", { name: /Stop warp/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Warp to first signal/ }),
    ).toBeNull();
  });

  it("shows the strip from the switch with the button ready while no delay is known or estimated", () => {
    renderBanner({
      ...snapshotOf([], 1_000),
      firstSignal: {
        vesselName: "Mun Probe",
        owltSeconds: null,
        estimated: false,
      },
    });
    expect(screen.getByText("Mun Probe")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Warp to first signal/ }),
    ).toBeEnabled();
  });

  it("shows nothing while no first signal is awaited", () => {
    renderBanner(snapshotOf([], 1_000));
    expect(screen.queryByText("Mun Probe")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Warp to first signal/ }),
    ).toBeNull();
  });
});
