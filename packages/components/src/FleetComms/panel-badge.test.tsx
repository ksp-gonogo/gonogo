import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import {
  NULL_DISPLAY,
  Panel,
  PanelBadgesProvider,
  useWidgetBadges,
} from "@ksp-gonogo/ui-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
// Importing the real module registers the badge contribution and its Processor; nothing else here registers anything.
import "./badge";

/**
 * The comms link badge reaches SystemView's header through the contribution
 * slot, wired the same chain the app's `GridItemContent` does. A stand-in
 * header replaces the real diagram, which needs fixtures irrelevant to the
 * badge.
 */

function SystemViewPanelHeader() {
  const badges = useWidgetBadges();
  return (
    <PanelBadgesProvider badges={badges}>
      <Panel panelTitle="SYSTEM">diagram</Panel>
    </PanelBadgesProvider>
  );
}

function renderPanel(fixture: StreamFixture) {
  return render(
    <fixture.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId: "system-view", contributionSlots: [] }}
      >
        <ContributionsProvider>
          <SystemViewPanelHeader />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
}

describe("SystemView panel badge (fleet-comms-badge contribution)", () => {
  let fixture: StreamFixture;
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    fixture = setupStreamFixture({
      pinnedUt: 100,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    unmount?.();
    unmount = undefined;
  });

  it("shows the unknown glyph before comms.link has ever delivered a sample", async () => {
    unmount = renderPanel(fixture).unmount;
    expect(await screen.findByText(NULL_DISPLAY)).toBeInTheDocument();
  });

  it("shows LINK once comms.link reports a connection", async () => {
    unmount = renderPanel(fixture).unmount;
    act(() => {
      fixture.emit("comms.link", { connected: true });
    });
    await waitFor(() => expect(screen.getByText("LINK")).toBeInTheDocument());
  });

  it("shows NO LINK for a positively-reported outage", async () => {
    unmount = renderPanel(fixture).unmount;
    act(() => {
      fixture.emit("comms.link", { connected: false });
    });
    await waitFor(() =>
      expect(screen.getByText("NO LINK")).toBeInTheDocument(),
    );
  });
});
