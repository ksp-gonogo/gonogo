import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { perItemGateReport } from "../test/perItemGate";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ExperimentsComponent } from "./index";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

const instrument = (experimentId: string, title: string) => ({
  partId: "77",
  partName: "Science Pod",
  experimentId,
  title,
  deployed: experimentId === "barometerScan",
  inoperable: false,
  rerunnable: true,
  resettable: false,
  holdsData: experimentId === "barometerScan",
});

describe("Experiments: Deploy follows the mod's gate for that experiment", () => {
  it("darkens Deploy for the one experiment the gate refuses and leaves its sibling on the same part live", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "exp-gate" }}>
          <ExperimentsComponent id="exp-gate" w={6} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);
    act(() => {
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [
        instrument("barometerScan", "Atmospheric Pressure Scan"),
        instrument("temperatureScan", "Temperature Scan"),
      ]);
      fixture.emit(
        "system.uplink.gates",
        perItemGateReport("science.experiment.deploy", "partId+experimentId", {
          "77\u001fbarometerScan": {
            errorCode: "wrongState",
            detail: "the experiment has already been run",
          },
        }),
      );
    });

    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-command-phase="blocked"]'),
      ).toHaveLength(1),
    );
    const blocked = document.querySelector(
      '[data-command-phase="blocked"]',
    ) as HTMLElement;
    expect(blocked.closest("li")?.textContent).toContain(
      "Atmospheric Pressure Scan",
    );
    const sibling = screen
      .getByText("Temperature Scan")
      .closest("li") as HTMLElement;
    expect(sibling.querySelector('[data-command-phase="blocked"]')).toBeNull();
  });
});

describe("Experiments: Transmit follows the mod's gate while the link reads up", () => {
  it("draws Transmit blocked with the game's reason when nothing aboard can carry the result, whatever the link says", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    const { unmount } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "exp-xmit-gate" }}>
          <ExperimentsComponent id="exp-xmit-gate" w={6} h={12} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    renderedTrees.push(unmount);
    act(() => {
      fixture.emit("comms.connectivity", { connected: true });
      fixture.emit("science.experiments", []);
      fixture.emit("science.instruments", [
        {
          ...instrument("temperatureScan", "Temperature Scan"),
          holdsData: true,
        },
      ]);
      fixture.emit("system.uplink.gates", {
        gates: [
          {
            command: "science.experiment.transmit",
            verdict: {
              outcome: 1,
              errorCode: "noConnection",
              detail: "no usable comms device aboard",
            },
            itemSets: [],
          },
        ],
        channels: [],
      });
    });

    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-command-phase="blocked"]'),
      ).not.toHaveLength(0),
    );
    const transmit = screen
      .getByText("Transmit")
      .closest("button") as HTMLElement;
    expect(transmit).toHaveAttribute("data-command-phase", "blocked");
  });
});
