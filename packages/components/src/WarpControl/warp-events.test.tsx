import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
} from "@ksp-gonogo/core";
import { TransitionType } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlarmsLauncherProvider } from "../shared/AlarmsLauncher";
import { isDisabled } from "../test/isDisabled";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

const VIEW_UT = 5_000_000;
const VESSEL = "11111111-1111-1111-1111-111111111111";
const INSTANCE = "warp-events";

interface Scenario {
  silent?: { predictedUt: number | null };
  soi?: { transition: TransitionType; endUt: number };
  loss?: { ut: number | null; basis: string; lowConfidence?: boolean };
  light?: {
    sunlit: boolean;
    sunriseUt: number | null;
    sunsetUt: number | null;
    basis?: string;
  };
}

async function mount(scenario: Scenario) {
  const fixture = setupStreamFixture({
    pinnedUt: VIEW_UT,
    suspendFrames: true,
  });
  const creator = vi.fn();
  const { container } = render(
    <fixture.Provider>
      <AlarmsLauncherProvider
        launcher={() => {}}
        creator={creator}
        pending={[]}
      >
        <DashboardItemContext.Provider value={{ instanceId: INSTANCE }}>
          <WarpControlComponent id={INSTANCE} w={6} h={7} config={{}} />
        </DashboardItemContext.Provider>
      </AlarmsLauncherProvider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("time.warp", {
      warpRate: 1,
      warpRateIndex: 0,
      warpMode: 0,
      paused: false,
    });
    fixture.emit("spaceCenter.scene", { scene: "Flight" });
    fixture.emit("vessel.identity", { vesselId: VESSEL });
    fixture.emit("fleet.silence", {
      vessels: [
        {
          vesselId: VESSEL,
          state: scenario.silent ? "Silent" : "Nominal",
          predictedReacquisitionUt: scenario.silent?.predictedUt ?? null,
        },
      ],
    });
    if (scenario.loss) {
      fixture.emit("comms.nextLoss", {
        ut: scenario.loss.ut,
        basis: scenario.loss.basis,
        coveredToUt: VIEW_UT + 21_600,
        lowConfidence: scenario.loss.lowConfidence ?? false,
      });
    }
    if (scenario.light) {
      fixture.emit("vessel.light", {
        sunlit: scenario.light.sunlit,
        nextSunriseUt: scenario.light.sunriseUt,
        nextSunsetUt: scenario.light.sunsetUt,
        sweptToUt: VIEW_UT + 7_200,
        basis: scenario.light.basis ?? "orbit",
      });
    }
    fixture.emit("vessel.orbit", {
      patches: scenario.soi
        ? [
            {
              referenceBody: "Kerbin",
              startUt: VIEW_UT - 100,
              endUt: scenario.soi.endUt,
              patchEndTransition: scenario.soi.transition,
            },
            { referenceBody: "Mun", startUt: scenario.soi.endUt },
          ]
        : [],
    });
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "1×" })).toBeTruthy(),
  );
  await act(async () => {});
  return { creator, container };
}

const open = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Warp to" }));
const armButton = () =>
  screen.getByRole("button", { name: "Set alarm" }) as HTMLButtonElement;

describe("WarpControl: event targets", () => {
  afterEach(() => {
    clearActionHandlers();
  });

  it("arms a time alarm at the predicted signal return", async () => {
    const user = userEvent.setup();
    const { creator, container } = await mount({
      silent: { predictedUt: VIEW_UT + 900 },
    });

    await open(user);
    await user.click(screen.getByRole("button", { name: "Signal back" }));
    expect(isDisabled(armButton())).toBe(false);
    await user.click(armButton());

    expect(creator).toHaveBeenCalledTimes(1);
    expect(creator.mock.calls[0][0]).toMatchObject({
      name: "Signal returns",
      trigger: { kind: "time", ut: VIEW_UT + 900 },
    });
    await expectNoA11yViolations(container);
  });

  it("shows no prediction, and arms nothing, while the craft is in contact", async () => {
    const user = userEvent.setup();
    const { creator } = await mount({});

    await open(user);
    await user.click(screen.getByRole("button", { name: "Signal back" }));

    expect(screen.getByText("No prediction")).toBeTruthy();
    expect(isDisabled(armButton())).toBe(true);
    expect(creator).not.toHaveBeenCalled();
  });

  it("shows no prediction when the craft is silent and none was made", async () => {
    const user = userEvent.setup();
    await mount({ silent: { predictedUt: null } });

    await open(user);
    await user.click(screen.getByRole("button", { name: "Signal back" }));

    expect(screen.getByText("No prediction")).toBeTruthy();
    expect(isDisabled(armButton())).toBe(true);
  });

  it("arms the next sphere-of-influence entry at the patch's end", async () => {
    const user = userEvent.setup();
    const { creator, container } = await mount({
      soi: { transition: TransitionType.Encounter, endUt: VIEW_UT + 4_000 },
    });

    await open(user);
    await user.click(screen.getByRole("button", { name: "SOI change" }));
    expect(screen.getByText("Enter Mun")).toBeTruthy();
    await user.click(armButton());

    expect(creator.mock.calls[0][0]).toMatchObject({
      name: "Enter Mun SOI",
      trigger: { kind: "time", ut: VIEW_UT + 4_000 },
    });
    await expectNoA11yViolations(container);
  });

  it("names the body being left on an escape", async () => {
    const user = userEvent.setup();
    await mount({
      soi: { transition: TransitionType.Escape, endUt: VIEW_UT + 4_000 },
    });

    await open(user);
    await user.click(screen.getByRole("button", { name: "SOI change" }));

    expect(screen.getByText("Leave Kerbin")).toBeTruthy();
  });

  it("offers no SOI change on a trajectory with no transition", async () => {
    const user = userEvent.setup();
    const { creator } = await mount({
      soi: { transition: TransitionType.Final, endUt: VIEW_UT + 4_000 },
    });

    await open(user);
    await user.click(screen.getByRole("button", { name: "SOI change" }));

    expect(screen.getByText("No prediction")).toBeTruthy();
    expect(isDisabled(armButton())).toBe(true);
    expect(creator).not.toHaveBeenCalled();
  });

  it("registers an action per event that arms the same alarm", async () => {
    const { creator } = await mount({
      silent: { predictedUt: VIEW_UT + 900 },
    });

    let result: unknown;
    act(() => {
      result = dispatchAction(INSTANCE, "warp-to-contact", {
        kind: "button",
        value: true,
      });
    });

    expect(result).toEqual({ Armed: "Signal returns" });
    expect(creator.mock.calls[0][0]).toMatchObject({
      trigger: { kind: "time", ut: VIEW_UT + 900 },
    });
  });

  it("does nothing on an action whose event has no instant", async () => {
    const { creator } = await mount({});

    let result: unknown = "unset";
    act(() => {
      result = dispatchAction(INSTANCE, "warp-to-soi", {
        kind: "button",
        value: true,
      });
    });

    expect(result).toBeUndefined();
    expect(creator).not.toHaveBeenCalled();
  });

  it("arms a time alarm at the predicted loss of signal", async () => {
    const user = userEvent.setup();
    const { creator, container } = await mount({
      loss: { ut: VIEW_UT + 2_400, basis: "predicted-loss" },
    });

    await open(user);
    await user.click(screen.getByRole("button", { name: "Signal lost" }));
    expect(isDisabled(armButton())).toBe(false);
    await user.click(armButton());

    expect(creator.mock.calls[0][0]).toMatchObject({
      name: "Signal lost",
      trigger: { kind: "time", ut: VIEW_UT + 2_400 },
    });
    await expectNoA11yViolations(container);
  });

  it("says why there is no loss of signal to warp to", async () => {
    const user = userEvent.setup();
    await mount({ loss: { ut: null, basis: "out-of-contact" } });

    await open(user);
    await user.click(screen.getByRole("button", { name: "Signal lost" }));

    expect(screen.getByText("Out of contact now")).toBeTruthy();
    expect(isDisabled(armButton())).toBe(true);
  });

  it("arms sunrise and sunset at the instants the mod predicts", async () => {
    const user = userEvent.setup();
    const { creator } = await mount({
      light: {
        sunlit: false,
        sunriseUt: VIEW_UT + 1_200,
        sunsetUt: VIEW_UT + 3_300,
      },
    });

    await open(user);
    await user.click(screen.getByRole("button", { name: "Sunrise" }));
    await user.click(armButton());
    await user.click(screen.getByRole("button", { name: "Sunset" }));
    await user.click(armButton());

    expect(creator.mock.calls[0][0]).toMatchObject({
      name: "Sunrise",
      trigger: { kind: "time", ut: VIEW_UT + 1_200 },
    });
    expect(creator.mock.calls[1][0]).toMatchObject({
      name: "Sunset",
      trigger: { kind: "time", ut: VIEW_UT + 3_300 },
    });
  });

  it("offers no sunrise when the mod withheld its prediction", async () => {
    const user = userEvent.setup();
    const { creator } = await mount({
      light: {
        sunlit: true,
        sunriseUt: null,
        sunsetUt: null,
        basis: "withheld",
      },
    });

    await open(user);
    await user.click(screen.getByRole("button", { name: "Sunrise" }));

    expect(screen.getByText("No prediction")).toBeTruthy();
    expect(isDisabled(armButton())).toBe(true);
    expect(creator).not.toHaveBeenCalled();
  });

  it("registers an action per new event that arms the same alarm", async () => {
    const { creator } = await mount({
      loss: { ut: VIEW_UT + 2_400, basis: "predicted-loss" },
      light: { sunlit: true, sunriseUt: null, sunsetUt: VIEW_UT + 600 },
    });

    let loss: unknown;
    let sunset: unknown;
    act(() => {
      loss = dispatchAction(INSTANCE, "warp-to-loss", {
        kind: "button",
        value: true,
      });
      sunset = dispatchAction(INSTANCE, "warp-to-sunset", {
        kind: "button",
        value: true,
      });
    });

    expect(loss).toEqual({ Armed: "Signal lost" });
    expect(sunset).toEqual({ Armed: "Sunset" });
    expect(creator).toHaveBeenCalledTimes(2);
  });
});
