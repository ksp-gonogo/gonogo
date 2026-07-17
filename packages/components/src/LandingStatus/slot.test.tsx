import {
  clearAugments,
  getAugmentsForSlot,
  registerAugment,
  registerStockBodies,
} from "@ksp-gonogo/core";
import {
  act,
  render as rtlRender,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  type LandingStatusBadgesContext,
  LandingStatusComponent,
} from "./index";

// Rendered trees, tracked so afterEach can unmount them synchronously before
// clearAugments() notifies the augment-slot subscribers and before the pinned-UT
// ViewClock's next requestAnimationFrame tick fires. RTL auto-cleanup runs after
// this file's afterEach, so it can't be relied on to unmount first — either
// update landing on the still-mounted widget (its AugmentSlot header) is a state
// update outside act(), the documented anti-pattern in CLAUDE.md.
const renderedTrees: Array<() => void> = [];

function render(ui: ReactElement) {
  const result = rtlRender(ui);
  renderedTrees.push(result.unmount);
  return result;
}

function unmountAll() {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
}

/**
 * LandingStatus augment-slot exposure (Uplink architecture). The widget
 * exposes one BROAD header escape-hatch slot (`landing-status.badges`) but
 * ships no filler here (that's an Uplink augment): an empty slot must
 * render cleanly, and a test augment registered into it must appear in the
 * header, receiving the widget's labelling context as typed slot props.
 *
 * `bodyName`/`atmospheric` (the slot context) both come off the real,
 * client-derived `vessel.state` channel now (see `stream.test.tsx`) — no
 * legacy fallback exists — so this drives a genuine `setupStreamFixture`
 * instead of a legacy `v.body` emit.
 */
const CARRIED = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

// The header row renders unconditionally, so the badges slot is present even
// in the idle "no landing" state — no need to drive a full prediction.
async function renderWidget() {
  registerStockBodies();
  const stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
  render(
    <stream.Provider>
      <LandingStatusComponent config={{}} id="landing-status-slot" />
    </stream.Provider>,
  );
  await screen.findByText("LANDING");
  act(() => {
    // Mun — a vacuum body — resolves `vessel.state.parentBodyName`.
    stream.emit("system.bodies", {
      bodies: [
        { name: "Mun", index: 3, parentIndex: 0, radius: 200_000, orbit: null },
      ],
    });
    stream.emit("vessel.identity", {
      vesselId: "test-vessel",
      name: "Test Vessel",
      vesselType: 0,
      situation: 0,
      parentBodyIndex: 3,
      launchUt: null,
    });
    stream.emit("vessel.orbit", {
      referenceBodyIndex: 3,
      sma: 250_000,
      ecc: 0.01,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      mu: 6.5138398e10,
    });
  });
  return stream;
}

describe("LandingStatus — augment slots (spec §4)", () => {
  afterEach(() => {
    // Unmount before clearing augments so the notify never lands on a mounted
    // widget (a ViewClock tick could also fire on it otherwise).
    unmountAll();
    // Wipe any test augment so it never leaks into the snapshot suite.
    clearAugments();
  });

  it("exposes the badges slot (empty until an augment binds)", () => {
    // The registry entry is asserted indirectly: the widget's own module-load
    // registration declared the slot as its extension point.
    // (See registerComponent `augmentSlots` in ./index.tsx.)
    expect(getAugmentsForSlot("landing-status.badges")).toEqual([]);
  });

  it("renders the header with no augments bound (empty slot is inert)", async () => {
    await renderWidget();
    expect(screen.getByText("LANDING")).toBeTruthy();
    expect(screen.queryByTestId("landing-status-badge-augment")).toBeNull();
  });

  it("renders a test augment bound to the badges slot in the header", async () => {
    function BadgeAugment({
      bodyName,
      atmospheric,
    }: LandingStatusBadgesContext) {
      return (
        <span data-testid="landing-status-badge-augment">
          {bodyName ?? "?"}|{atmospheric ? "atm" : "vac"}
        </span>
      );
    }
    await renderWidget();

    act(() => {
      registerAugment({
        id: "test-landing-status-badge",
        augments: "landing-status.badges",
        component: BadgeAugment,
      });
    });

    const badge = await screen.findByTestId("landing-status-badge-augment");
    // The slot passed the widget's labelling context down: the current
    // body and its atmosphere flag (Mun is a vacuum body). The pinned view
    // clock's first frame tick (and so `vessel.state.parentBodyName`) lands
    // asynchronously — wait rather than asserting on the pre-frame "?".
    await waitFor(() => expect(badge.textContent).toBe("Mun|vac"));
  });
});
