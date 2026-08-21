import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { clearProcessorRuntime } from "@ksp-gonogo/sitrep-client";
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
// Importing the real module runs its module-load
// `CORE_UPLINK_CLIENT.registerContribution(...)` (the badge under test) and
// the Processor it deps on. Nothing else in this file registers anything, so
// if that registration is ever dropped every case here goes to the unknown
// glyph and fails.
import "./badge";

/**
 * End-to-end proof that the comms link badge reaches SystemView's header
 * through the CONTRIBUTION slot, not the augment slot it used to ride
 * (`badge.test.ts` covers the label/tone table on its own). Wires the same
 * chain the app's `GridItemContent` does: `WidgetMetaContext` ->
 * `ContributionsProvider` -> `useWidgetBadges` -> `PanelBadgesProvider` ->
 * `Panel`, so a break anywhere along it shows up here rather than only inside
 * `commsLinkBadge`.
 *
 * Mounts a stand-in header rather than the real `SystemViewComponent`: the
 * widget under test is the badge, and the diagram needs a body/orbit fixture
 * that has nothing to do with whether a contribution lands in the header.
 * `FleetComms/slot.test.tsx` still renders the real SystemView for the overlay
 * and actions augments.
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
    // The Processor evaluator caches per frame in a module global; a value
    // cached against the previous test's fixture would otherwise answer here.
    clearProcessorRuntime();
    fixture = setupStreamFixture({
      carriedChannels: ["comms.link"],
      pinnedUt: 100,
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
