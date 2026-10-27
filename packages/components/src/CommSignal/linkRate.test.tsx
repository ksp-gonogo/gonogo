import {
  ContributionsProvider,
  clearContributions,
  DashboardItemContext,
  registerContribution,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

const META = {
  componentId: "comm-signal",
  contributionSlots: ["comm-signal.link-rate"] as const,
};

// Cleared before each rather than after, so no mounted tree is notified outside act.
beforeEach(() => {
  clearContributions();
});

function mount(connected: boolean) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <WidgetMetaContext.Provider value={META}>
        <ContributionsProvider>
          <DashboardItemContext.Provider value={{ instanceId: "link-rate" }}>
            <CommSignalComponent id="link-rate" w={6} h={6} />
          </DashboardItemContext.Provider>
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("comms.link", { connected });
    fixture.emit("vessel.comms", {
      connected,
      signalStrength: 0.87,
      controlState: 4,
    });
    fixture.emit("comms.signal", { strength: 0.87, modelled: false });
  });
  return fixture;
}

describe("CommSignal: link-rate slot", () => {
  it("draws no rate or target row when nothing contributes", async () => {
    mount(true);
    await waitFor(() => expect(visibleText()).toContain("87 %"));
    expect(screen.queryByText("Data rate")).toBeNull();
    expect(screen.queryByText("Target")).toBeNull();
  });

  it("draws the contributed rate in bit/s and the target beneath it", async () => {
    registerContribution({
      id: "test-link-rate",
      contributes: "comm-signal.link-rate",
      compute: () => [{ bitsPerSec: 144_000, target: "DSN: KSC" }],
    });
    mount(true);
    await waitFor(() => expect(screen.getByText("Data rate")).toBeTruthy());
    expect(visibleText()).toContain("144.0 kbit/s");
    expect(screen.getByText("Target")).toBeTruthy();
    expect(screen.getByText("DSN: KSC")).toBeTruthy();
  });

  it("leaves the target row out when the contributor names none", async () => {
    registerContribution({
      id: "test-link-rate-only",
      contributes: "comm-signal.link-rate",
      compute: () => [{ bitsPerSec: 9_600 }],
    });
    mount(true);
    await waitFor(() => expect(screen.getByText("Data rate")).toBeTruthy());
    expect(screen.queryByText("Target")).toBeNull();
  });

  it("draws only the highest priority band, so one Uplink's rate replaces another's", async () => {
    registerContribution({
      id: "test-link-rate-simple",
      contributes: "comm-signal.link-rate",
      priority: 1,
      compute: () => [{ bitsPerSec: 144_000, target: "DSN: KSC" }],
    });
    registerContribution({
      id: "test-link-rate-detailed",
      contributes: "comm-signal.link-rate",
      priority: 2,
      compute: () => [{ bitsPerSec: 262_000 }],
    });
    mount(true);
    await waitFor(() => expect(visibleText()).toContain("262.0 kbit/s"));
    expect(visibleText()).not.toContain("144.0 kbit/s");
    expect(screen.queryByText("DSN: KSC")).toBeNull();
  });

  it("withholds the rows while the link is down", async () => {
    registerContribution({
      id: "test-link-rate-down",
      contributes: "comm-signal.link-rate",
      compute: () => [{ bitsPerSec: 144_000, target: "DSN: KSC" }],
    });
    mount(false);
    await waitFor(() => expect(screen.getByText("Control")).toBeTruthy());
    expect(screen.queryByText("Data rate")).toBeNull();
  });
});
