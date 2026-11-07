import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import {
  Panel,
  PanelBadgesProvider,
  useWidgetBadges,
} from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequiresGuard } from "../shared/RequiresGuard";
import { setupStreamFixture } from "../test/setupStreamFixture";
import "./badge";

function CommSignalPanel() {
  const badges = useWidgetBadges();
  return (
    <PanelBadgesProvider badges={badges}>
      <Panel panelTitle="COMMNET">body</Panel>
    </PanelBadgesProvider>
  );
}

describe("CommNet Signal across a quicksave load", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never reads No signal while the scene reloads and the link is null, and is live again after", () => {
    vi.useFakeTimers();
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    render(
      <fixture.Provider>
        <WidgetMetaContext.Provider
          value={{ componentId: "comm-signal", contributionSlots: [] }}
        >
          <ContributionsProvider>
            <RequiresGuard
              awaitsFirstSignal={{ heading: "COMMNET" }}
              title="COMMNET"
            >
              <CommSignalPanel />
            </RequiresGuard>
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </fixture.Provider>,
    );
    const noSignal = () => screen.queryByText("No signal");

    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.87 });
    });
    expect(screen.getByText("COMMNET")).toBeTruthy();
    expect(noSignal()).toBeNull();

    act(() => {
      fixture.store.setGameState("loading", "FLIGHT");
      vi.advanceTimersByTime(1000);
      fixture.emitFrame();
    });
    expect(noSignal()).toBeNull();
    expect(screen.getByText(/awaiting first signal/i)).toBeTruthy();

    act(() => {
      fixture.emit("comms.link", null);
    });
    expect(noSignal()).toBeNull();

    act(() => {
      fixture.store.setGameState("ready", "FLIGHT");
      fixture.emitFrame();
    });
    expect(noSignal()).toBeNull();

    act(() => {
      fixture.emit("comms.link", { connected: true });
      fixture.emit("vessel.comms", { connected: true, signalStrength: 0.87 });
    });
    expect(noSignal()).toBeNull();
    expect(screen.queryByText(/awaiting first signal/i)).toBeNull();
  });
});
