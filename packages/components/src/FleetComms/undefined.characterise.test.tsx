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
// Side-effect import: registers the badge through `./index`, the way the app gets it.
import "./index";
import { __resetFleetCommsTogglesForTests } from "./toggles";

/**
 * What FleetComms's link badge does when `comms.link` is absent for any of its
 * three causes (never landed, a tombstone, `connected` omitted): never LINK or
 * NO LINK. One not yet heard from is awaited; the other two are the honest
 * unknown.
 */

const PINNED_UT = 100;

let fixture: StreamFixture;
const teardowns: Array<() => void> = [];

beforeEach(() => {
  __resetFleetCommsTogglesForTests();
  fixture = setupStreamFixture({
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
    screen.queryByText("COMMS LINKED") ??
    screen.queryByText("NO COMMS LINK") ??
    screen.queryByText("COMMS AWAITING") ??
    screen.queryByText(`COMMS ${NULL_DISPLAY}`);
  return pill?.textContent ?? null;
}

describe("FleetComms badge: what undefined means today", () => {
  it("renders the link as awaited, not a link state, when comms.link has never arrived", async () => {
    renderBadge();

    // A reading not yet heard from is awaited, neither LINK nor NO LINK.
    await waitFor(() => expect(badgeText()).toBe("COMMS AWAITING"));
    expect(badgeText()).not.toBe("COMMS LINKED");
    expect(badgeText()).not.toBe("NO COMMS LINK");
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

    // A tombstone is an answer, so it is the honest unknown rather than awaited.
    await waitFor(() => expect(badgeText()).toBe(`COMMS ${NULL_DISPLAY}`));
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
    await waitFor(() => expect(badgeText()).toBe(`COMMS ${NULL_DISPLAY}`));
  });
});
