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
// Side-effect import: registers the badge through `./index`, the way the app gets it.
import "./index";
import { __resetFleetCommsTogglesForTests } from "./toggles";

/**
 * What FleetComms's link badge does when `comms.link` is absent for any of its
 * three causes (never landed, a tombstone, `connected` omitted): every one must
 * read as the honest unknown, never LINK or NO LINK.
 */

const PINNED_UT = 100;

const CARRIED = [
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
  "comms.path",
  "comms.link",
  "system.uplink.pending",
];

let fixture: StreamFixture;
const teardowns: Array<() => void> = [];

beforeEach(() => {
  __resetFleetCommsTogglesForTests();
  // The badge's Processor caches per frame in a module global.
  clearProcessorRuntime();
  fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: PINNED_UT,
    suspendFrames: true,
  });
});

afterEach(() => {
  for (const teardown of teardowns) teardown();
  teardowns.length = 0;
});

/** SystemView's header badge row, wired the way the dashboard wires it. */
function BadgeHeader() {
  const badges = useWidgetBadges();
  return (
    <PanelBadgesProvider badges={badges}>
      <Panel panelTitle="SYSTEM">diagram</Panel>
    </PanelBadgesProvider>
  );
}

function renderBadge() {
  const rendered = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId: "system-view", contributionSlots: [] }}
      >
        <ContributionsProvider>
          <BadgeHeader />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  teardowns.push(rendered.unmount);
  return rendered;
}

/** The one pill in the rendered header, whatever it currently says. */
function badgeText(): string | null {
  const pill =
    screen.queryByText("LINK") ??
    screen.queryByText("NO LINK") ??
    screen.queryByText(NULL_DISPLAY);
  return pill?.textContent ?? null;
}

describe("FleetComms badge: what undefined means today", () => {
  it("renders the placeholder glyph, not a link state, when comms.link has never arrived", async () => {
    renderBadge();

    // An unobserved reading resolves to the honest unknown, neither LINK nor NO LINK.
    await waitFor(() => expect(badgeText()).toBe(NULL_DISPLAY));
    expect(badgeText()).not.toBe("LINK");
    expect(badgeText()).not.toBe("NO LINK");
  });

  it("renders that same placeholder for a confirmed comms.link tombstone", async () => {
    renderBadge();

    act(() => {
      // A whole-topic tombstone, distinguishable from never-arrived at the read.
      fixture.emit("comms.link", null);
    });

    // Proof the tombstone landed.
    await waitFor(() =>
      expect(fixture.store.sample("comms.link")?.payload).toBeNull(),
    );

    // The badge renders a tombstone the same as never-arrived.
    await waitFor(() => expect(badgeText()).toBe(NULL_DISPLAY));
  });

  it("renders that same placeholder when the record arrives without a connected field", async () => {
    renderBadge();

    act(() => {
      // The record exists, the field inside it does not.
      fixture.emit("comms.link", {});
    });
    await waitFor(() =>
      expect(fixture.store.sample("comms.link")?.payload).toEqual({}),
    );

    // A live comms record without `connected` renders as unknown too.
    await waitFor(() => expect(badgeText()).toBe(NULL_DISPLAY));
  });
});
