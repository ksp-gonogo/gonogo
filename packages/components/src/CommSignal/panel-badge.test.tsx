import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { clearProcessorRuntime } from "@ksp-gonogo/sitrep-client";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import {
  Panel,
  PanelBadgesProvider,
  useWidgetBadges,
} from "@ksp-gonogo/ui-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import "./badge";

function CommSignalPanelHeader() {
  const badges = useWidgetBadges();
  return (
    <PanelBadgesProvider badges={badges}>
      <Panel panelTitle="COMMNET">body</Panel>
    </PanelBadgesProvider>
  );
}

function renderPanel(fixture: StreamFixture) {
  return render(
    <fixture.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId: "comm-signal", contributionSlots: [] }}
      >
        <ContributionsProvider>
          <CommSignalPanelHeader />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
}

describe("CommSignal panel badge (comm-signal-no-signal-badge contribution)", () => {
  let fixture: StreamFixture;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    clearProcessorRuntime();
    fixture = setupStreamFixture({
      carriedChannels: ["comms.link", "vessel.comms"],
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    unmount?.();
    unmount = undefined;
  });

  it("shows no badge before either channel has delivered a sample", () => {
    unmount = renderPanel(fixture).unmount;
    expect(screen.queryByText("No signal")).toBeNull();
  });

  it("shows no badge while the link is current", async () => {
    unmount = renderPanel(fixture).unmount;
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.87 });
    });
    await waitFor(() => expect(screen.getByText("COMMNET")).toBeTruthy());
    expect(screen.queryByText("No signal")).toBeNull();
  });

  it("shows one warning-toned 'No signal' badge once the link goes stale", async () => {
    unmount = renderPanel(fixture).unmount;
    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.87 });
    });
    await waitFor(() => expect(screen.getByText("COMMNET")).toBeTruthy());

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() =>
      expect(screen.getAllByText("No signal")).toHaveLength(1),
    );
  });
});
