import { DashboardItemContext } from "@ksp-gonogo/core";
import { Situation, VesselType } from "@ksp-gonogo/sitrep-sdk";
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

function entry(name: string, vesselType: VesselType, situation: Situation) {
  return {
    vesselId: `guid-${name}`,
    name,
    vesselType,
    situation,
    bodyIndex: 1,
  };
}

describe("LaunchDirector at the Space Center", () => {
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

  async function emitSpaceCenter() {
    act(() => {
      stream.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      stream.emit("spaceCenter.launchSites", [
        { name: "LaunchPad", displayName: "Launch Pad", editorFacility: "VAB" },
      ]);
      stream.emit("system.vessels", {
        vessels: [
          entry("Dune Buggy", VesselType.Rover, Situation.Landed),
          entry("Duna Relay", VesselType.Relay, Situation.Orbiting),
          entry("Asteroid XYZ", VesselType.SpaceObject, Situation.Orbiting),
        ],
      });
    });
    await screen.findByText("Launch Pad");
  }

  function sent(command: string) {
    return stream.transport.sentCommands.filter((c) => c.command === command);
  }

  it("lists the fleet without asteroids and sends ksp.switchVessel with the stable id", async () => {
    const user = userEvent.setup();
    renderWidget();
    await emitSpaceCenter();

    const trigger = await screen.findByRole("button", { name: /Fly vessel/ });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    expect(screen.getByText("Duna Relay")).toBeInTheDocument();
    expect(screen.queryByText("Asteroid XYZ")).not.toBeInTheDocument();
    await user.click(screen.getByText("Dune Buggy"));
    await waitFor(() =>
      expect(sent("ksp.switchVessel")[0]).toMatchObject({
        args: { vesselId: "guid-Dune Buggy" },
        vantage: "meta",
      }),
    );
  });

  it("offers no trigger when the fleet holds only asteroids", async () => {
    renderWidget();
    await emitSpaceCenter();
    act(() => {
      stream.emit("system.vessels", {
        vessels: [
          entry("Asteroid XYZ", VesselType.SpaceObject, Situation.Orbiting),
        ],
      });
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Fly vessel/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it("stays accessible with the list open", async () => {
    const user = userEvent.setup();
    const { container } = renderWidget();
    await emitSpaceCenter();
    const trigger = await screen.findByRole("button", { name: /Fly vessel/ });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await expectNoA11yViolations(container);
  });
});
