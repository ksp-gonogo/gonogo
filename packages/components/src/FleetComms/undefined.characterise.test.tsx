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
// Side-effect import: registers the badge contribution the way the app gets
// it, through `./index`'s own import of `./badge`, so the wiring under test is
// the real one rather than a direct registration this file arranged.
import "./index";
import { __resetFleetCommsTogglesForTests } from "./toggles";

/**
 * What FleetComms's link badge DOES when its `comms.link` read is absent,
 * recorded because absence has three distinct causes here and the badge
 * renders them all the same way: no sample has ever landed, a confirmed
 * tombstone, and a live record that simply omitted `connected`.
 *
 * A third state (`NULL_DISPLAY`, an honest unknown) is the right answer for
 * all three, and these cases are what would catch it collapsing into a
 * confident LINK or NO LINK.
 *
 * The overlay's own absence policy used to be recorded here too, and
 * disagreed with the badge's on the same topic: it tested
 * `linkConnected === false`, so an unknown link fell through and drew as the
 * GO colour, solid, indistinguishable from a confirmed one. That overlay is
 * gone, its comms drawing having moved onto SystemView's contribution model,
 * so the disagreement went with it.
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
  // The badge rides a Processor now; its per-frame cache is a module global.
  clearProcessorRuntime();
  fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: PINNED_UT,
  });
});

afterEach(() => {
  for (const teardown of teardowns) teardown();
  teardowns.length = 0;
});

/**
 * SystemView's header badge row, wired the way the dashboard wires it: the
 * badge is a CONTRIBUTION now (`./badge.ts`), so there is no component to
 * render on its own and the assertions below read the pill Panel draws.
 */
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

    // An unobserved reading resolving to `null` picks the third, honest state:
    // neither LINK nor NO LINK. The badge is the ONE read in this file that
    // draws unknown distinctly, which is why the overlay's identical read
    // drawing it as connected (below) is worth pinning separately.
    await waitFor(() => expect(badgeText()).toBe(NULL_DISPLAY));
    expect(badgeText()).not.toBe("LINK");
    expect(badgeText()).not.toBe("NO LINK");
  });

  it("renders that same placeholder for a confirmed comms.link tombstone", async () => {
    renderBadge();

    act(() => {
      // A whole-topic tombstone: the subject states there is no comms record.
      // The store keeps `undefined` for never-arrived and `null` for this, so
      // the two ARE distinguishable at the read.
      fixture.emit("comms.link", null);
    });

    // Proof the tombstone landed, so the assertion below is about the widget's
    // policy and not about a dropped emit.
    await waitFor(() =>
      expect(fixture.store.sample("comms.link")?.payload).toBeNull(),
    );

    // The widget does NOT distinguish them: `link?.connected` short-circuits on
    // `null` to `undefined`, then `?? null` lands on the same branch as
    // never-arrived. "Confirmed no comms record" and "nothing has come through"
    // render identically.
    await waitFor(() => expect(badgeText()).toBe(NULL_DISPLAY));
  });

  it("renders that same placeholder when the record arrives without a connected field", async () => {
    renderBadge();

    act(() => {
      // Partial payload: the record exists, the field inside it does not.
      fixture.emit("comms.link", {});
    });
    await waitFor(() =>
      expect(fixture.store.sample("comms.link")?.payload).toEqual({}),
    );

    // Third meaning collapsed onto the same render: a live comms Uplink that
    // simply omitted `connected` is indistinguishable from no Uplink at all.
    await waitFor(() => expect(badgeText()).toBe(NULL_DISPLAY));
  });
});
