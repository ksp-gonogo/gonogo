import { render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { AlarmBanner } from "./AlarmBanner";
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

describe("AlarmBanner T-minus", () => {
  it("counts down to a future time alarm on the GAME clock", () => {
    // 8100 game seconds: two hours and a quarter, the same ladder the kit
    // walks for the `time` kind.
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
