import {
  AlarmsLauncherProvider,
  WarpControlComponent,
} from "@ksp-gonogo/components";
import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AlarmBanner } from "./AlarmBanner";
import { AlarmHostProvider } from "./AlarmHostContext";
import { AlarmHostService } from "./AlarmHostService";
import { AlarmsModal } from "./AlarmsModal";
import type { Alarm, AlarmSnapshot } from "./types";

const DELAY = 10;
const FIRES_AT = 1070;
/** The view clock, a signal delay behind the game, when the game reaches the alarm. */
const VIEW_UT = FIRES_AT - DELAY;

const alarm: Alarm = {
  id: "a1",
  name: "Burn",
  trigger: { kind: "time", ut: FIRES_AT, leadSeconds: 10 },
  state: "pending",
  createdBy: "main",
  createdAt: 0,
};

const snapshot: AlarmSnapshot = {
  alarms: [alarm],
  ut: VIEW_UT,
  warp: { index: 0, rate: 1, mode: "UNKNOWN" },
  unscheduledWarp: null,
  warpTo: null,
  warpSafetyMarginSeconds: 10,
};

describe("an alarm's countdowns at 10 s of delay", () => {
  it("all read zero at the UT the game fires it", async () => {
    const service = new AlarmHostService(null);
    service.snapshot = () => snapshot;
    service.subscribe = () => () => {};
    const fixture = setupStreamFixture({
      pinnedUt: VIEW_UT,
      delaySeconds: DELAY,
      suspendFrames: true,
    });
    render(
      <fixture.Provider>
        <AlarmHostProvider service={service}>
          <AlarmBanner />
          <AlarmsModal
            useSnapshot={() => snapshot}
            onAdd={() => {}}
            onUpdate={() => {}}
            onDelete={() => {}}
          />
          <DashboardItemContext.Provider value={{ instanceId: "warp" }}>
            <AlarmsLauncherProvider
              launcher={() => {}}
              pending={[{ id: "a1", name: "Burn", ut: FIRES_AT }]}
            >
              <WarpControlComponent id="warp" w={6} h={5} config={{}} />
            </AlarmsLauncherProvider>
          </DashboardItemContext.Provider>
        </AlarmHostProvider>
      </fixture.Provider>,
    );
    await act(async () => {});

    expect(screen.getByRole("status").textContent).toContain("T = 0");
    const rows = screen
      .getAllByText(/T[−+]/)
      .map((el) => el.parentElement?.textContent ?? "");
    expect(rows.some((row) => /T[−+]0\s?s · lead/.test(row))).toBe(true);
    expect(screen.getByLabelText("Next alarm").textContent).toMatch(/\b0\s?s/);
    service.dispose();
  });
});
