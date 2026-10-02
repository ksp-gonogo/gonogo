import { DashboardItemContext } from "@ksp-gonogo/core";
import { ManeuverFrame } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AlarmsLauncherProvider } from "../shared/AlarmsLauncher";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { WarpControlComponent } from "./index";

const VIEW_UT = 5_000_000;
const NODE_UT = VIEW_UT + 1_000;

async function mount(opts: { withNode: boolean; withCreator?: boolean }) {
  const fixture = setupStreamFixture({
    pinnedUt: VIEW_UT,
    suspendFrames: true,
  });
  const creator = vi.fn();
  const { container } = render(
    <fixture.Provider>
      <AlarmsLauncherProvider
        launcher={() => {}}
        creator={opts.withCreator === false ? undefined : creator}
        pending={[]}
      >
        <DashboardItemContext.Provider value={{ instanceId: "warp-to" }}>
          <WarpControlComponent id="warp-to" w={6} h={7} config={{}} />
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
    if (opts.withNode) {
      fixture.emit("vessel.maneuver", {
        nodes: [
          {
            id: "0",
            ut: NODE_UT,
            dvRadial: 0,
            dvNormal: 0,
            dvPrograde: 100,
            dvTotal: 100,
            frame: ManeuverFrame.RadialNormalPrograde,
            patches: [],
          },
        ],
      });
    }
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "1×" })).toBeTruthy(),
  );
  await act(async () => {});
  return { creator, container };
}

describe("WarpControl: warp-to targets", () => {
  it("hides the row when no alarm creator is mounted", async () => {
    await mount({ withNode: false, withCreator: false });
    expect(screen.queryByRole("button", { name: "Warp to" })).toBeNull();
  });

  it("arms a time alarm at the node instant minus the lead", async () => {
    const user = userEvent.setup();
    const { creator, container } = await mount({ withNode: true });

    await user.click(screen.getByRole("button", { name: "Warp to" }));
    await user.click(screen.getByRole("button", { name: "Node minus lead" }));
    await user.click(screen.getByRole("button", { name: "Set alarm" }));

    expect(creator).toHaveBeenCalledTimes(1);
    expect(creator.mock.calls[0][0]).toMatchObject({
      name: expect.stringContaining("Node minus"),
      trigger: { kind: "time", ut: NODE_UT - 60 },
    });
    await expectNoA11yViolations(container);
  });

  it("offers nothing to arm on node mode with no node ahead", async () => {
    const user = userEvent.setup();
    const { creator } = await mount({ withNode: false });

    await user.click(screen.getByRole("button", { name: "Warp to" }));
    await user.click(screen.getByRole("button", { name: "Node minus lead" }));

    expect(screen.getByText("No maneuver node ahead")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Set alarm" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(creator).not.toHaveBeenCalled();
  });

  it("refuses a UT already behind the clock, and arms one ahead of it", async () => {
    const user = userEvent.setup();
    const { creator } = await mount({ withNode: false });

    await user.click(screen.getByRole("button", { name: "Warp to" }));
    const arm = () =>
      screen.getByRole("button", { name: "Set alarm" }) as HTMLButtonElement;
    // Nothing is stated until the operator types an instant.
    expect(arm().disabled).toBe(true);

    const day = screen.getByRole("spinbutton", { name: "Target instant DAY" });
    await user.clear(day);
    await user.type(day, "3");
    expect(screen.getByText("Already past")).toBeTruthy();
    expect(arm().disabled).toBe(true);

    await user.clear(day);
    await user.type(day, "300");
    expect(arm().disabled).toBe(false);
    await user.click(arm());

    expect(creator.mock.calls[0][0]).toMatchObject({
      name: "Warp to UT",
      trigger: { kind: "time", ut: 299 * 21_600 },
    });
  });
});
