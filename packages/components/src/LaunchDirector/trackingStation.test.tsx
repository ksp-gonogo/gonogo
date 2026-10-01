import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LaunchDirectorComponent } from "./index";

/** The Tracking Station is where an operator driving from the app used to be stranded. */
describe("LaunchDirector in the Tracking Station", () => {
  let cmdFixture: MockDataSourceFixture;
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    cmdFixture = await setupMockDataSource({ keys: [] });
    stream = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  });

  afterEach(() => {
    teardownMockDataSource(cmdFixture);
  });

  function renderWidget() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ld" }}>
          <LaunchDirectorComponent id="ld" h={18} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  /** The roster is delivered once the panel has subscribed, so it follows the scene. */
  async function emitTrackingStation() {
    act(() => {
      stream.emit("spaceCenter.scene", { scene: "TrackingStation" });
    });
    await screen.findByText("In the Tracking Station");
    act(() => {
      stream.emit("system.vessels", {
        vessels: [
          { vesselId: "guid-a", name: "Mun Lander", vesselType: 2 },
          { vesselId: "guid-rock", name: "Asteroid XYZ", vesselType: 10 },
        ],
      });
    });
  }

  async function openFlyList(user: ReturnType<typeof userEvent.setup>) {
    const trigger = await screen.findByRole("button", { name: /Fly vessel/ });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
  }

  function sent(command: string) {
    return stream.transport.sentCommands.filter((c) => c.command === command);
  }

  it("offers the Space Center, and sends ksp.toSpaceCenter after a confirm", async () => {
    const user = userEvent.setup();
    renderWidget();
    await emitTrackingStation();

    await screen.findByText("In the Tracking Station");
    expect(screen.queryByText("Launch")).not.toBeInTheDocument();
    await user.click(await screen.findByText("Space Center"));
    expect(sent("ksp.toSpaceCenter")).toHaveLength(0);
    await user.click(screen.getByText(/Confirm: save and leave/i));
    await waitFor(() =>
      expect(sent("ksp.toSpaceCenter")[0]).toMatchObject({ vantage: "meta" }),
    );
  });

  it("lists the fleet without asteroids and sends ksp.switchVessel with the stable id", async () => {
    const user = userEvent.setup();
    renderWidget();
    await emitTrackingStation();

    await openFlyList(user);
    expect(screen.queryByText("Asteroid XYZ")).not.toBeInTheDocument();
    await user.click(screen.getByText("Mun Lander"));
    await waitFor(() =>
      expect(sent("ksp.switchVessel")[0]).toMatchObject({
        args: { vesselId: "guid-a" },
        vantage: "meta",
      }),
    );
  });

  it("stays accessible with the list open", async () => {
    const user = userEvent.setup();
    const { container } = renderWidget();
    await emitTrackingStation();
    await openFlyList(user);
    await expectNoA11yViolations(container);
  });
});
