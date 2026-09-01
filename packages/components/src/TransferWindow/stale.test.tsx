import { clearRegistry, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TransferWindowComponent } from "./index";

/**
 * What TransferWindow does when the parking orbit stops being current.
 *
 * The decision: it keeps planning, and says which half of the panel is dated.
 * Nothing this widget judges comes off the vessel channel. The phase dial, the
 * IDEAL/NEAR/FAR badge and the window countdowns are computed from the body
 * catalogue propagated to the view time, so they are as current as the clock. The
 * orbit contributes the origin body (an SOI transition is an event) and the
 * parking radius (Keplerian elements do not drift on their own), and those set the
 * ejection Δv, a planning figure for a departure days to years away. A number like
 * that can be dated honestly, so blanking a live board over it would cost the
 * operator the whole instrument to caption one row.
 *
 * The assertions worth having are therefore about DISTINGUISHABILITY. Held, cold
 * and confirmed-none each have to read differently from outside the component,
 * because "the elements are a minute old" and "this vessel is not in an orbit" are
 * different situations and the second one is not a link fault.
 */

const DEG = Math.PI / 180;

// Same wire bodies as index.test.tsx, so all three files agree on the system.
const SUN = {
  index: 0,
  name: "Sun",
  gravParameter: 1.32712440018e20,
  radius: 6.957e8,
};
const EARTH = {
  index: 1,
  name: "Earth",
  parentIndex: 0,
  gravParameter: 3.986004418e14,
  radius: 6.371e6,
  orbit: {
    sma: 1.495978707e11,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
  },
};
const MARS = {
  index: 2,
  name: "Mars",
  parentIndex: 0,
  gravParameter: 4.282837e13,
  radius: 3.3895e6,
  orbit: {
    sma: 2.279392e11,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 44.3 * DEG,
    epoch: 0,
  },
};

const LEO = {
  referenceBodyIndex: 1,
  sma: 7.071e6,
  ecc: 0,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: 3.986004418e14,
};

const HELD_NOTE = /Parking orbit no longer current/;
const COLD_PLACEHOLDER = "Waiting for vessel orbit...";
const NO_ORBIT = /No parking orbit/;

// Unmounted before clearRegistry, which notifies the DataSource-registry
// subscribers every useTelemetry keeps wired: firing that on a mounted widget is
// a state update outside act(). Same note as index.test.tsx.
const renderedTrees: Array<() => void> = [];

function renderTracked(ui: ReactElement) {
  const result = render(ui);
  renderedTrees.push(result.unmount);
  return result;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearRegistry();
});

function setup() {
  const fixture = setupStreamFixture({
    carriedChannels: ["system.bodies", "vessel.orbit", "target.available"],
    pinnedUt: 0,
    suspendFrames: true,
  });
  const view = renderTracked(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "transfer-stale" }}>
        <TransferWindowComponent
          id="transfer-stale"
          config={{ showPorkchop: true }}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, view };
}

function emitParked(fixture: ReturnType<typeof setupStreamFixture>) {
  act(() => {
    fixture.emit("system.bodies", { bodies: [SUN, EARTH, MARS] });
    fixture.emit("vessel.orbit", LEO);
  });
}

/** Drop the transport, so every carried topic's reading goes `stale`. */
function loseTheLink(fixture: ReturnType<typeof setupStreamFixture>) {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

describe("TransferWindow when the parking orbit is no longer current", () => {
  it("says nothing about a held orbit while the telemetry is current", async () => {
    // The control. Without it every assertion below would also pass on a widget
    // that renders the caption unconditionally, or on one that never plans.
    const { fixture, view } = setup();
    emitParked(fixture);
    await waitFor(() =>
      expect(screen.getByText("Current phase")).toBeInTheDocument(),
    );
    expect(screen.getByText("Ejection Δv")).toBeInTheDocument();
    expect(visibleText(view.container)).not.toMatch(HELD_NOTE);
  });

  it("keeps the dial, the badge and the windows list drawn, and captions the Δv", async () => {
    const { fixture, view } = setup();
    emitParked(fixture);
    await waitFor(() =>
      expect(screen.getByText("Current phase")).toBeInTheDocument(),
    );

    loseTheLink(fixture);

    await waitFor(() => expect(visibleText(view.container)).toMatch(HELD_NOTE));
    // Held, not withheld: the instruments that ride the body catalogue are still
    // there, and the caption names the one figure that does not.
    expect(screen.getByText("Current phase")).toBeInTheDocument();
    expect(screen.getByText("IDEAL")).toBeInTheDocument();
    expect(screen.getByText(/^Windows to$/)).toBeInTheDocument();
    expect(screen.getByText("Ejection Δv")).toBeInTheDocument();
    expect(visibleText(view.container)).toMatch(/Δv is from the last known/);
  });

  it("does not fall back to either empty state, so held reads as neither cold nor orbitless", async () => {
    // The distinction the file exists for. "Waiting for vessel orbit..." accuses
    // the link of never having delivered, and "No parking orbit" is a statement
    // about the craft. Reaching either from a held reading would misreport it.
    const { fixture, view } = setup();
    emitParked(fixture);
    await waitFor(() =>
      expect(screen.getByText("Current phase")).toBeInTheDocument(),
    );

    loseTheLink(fixture);

    await waitFor(() => expect(visibleText(view.container)).toMatch(HELD_NOTE));
    expect(visibleText(view.container)).not.toContain(COLD_PLACEHOLDER);
    expect(visibleText(view.container)).not.toMatch(NO_ORBIT);
  });

  it("says nothing about a held orbit before anything has ever arrived", async () => {
    // A cold start is not a lost link. Conflating them would accuse the relay on
    // first paint, every paint.
    const { view } = setup();
    expect(await screen.findByText(COLD_PLACEHOLDER)).toBeInTheDocument();
    expect(visibleText(view.container)).not.toMatch(HELD_NOTE);
  });

  it("does not caption a confirmed tombstone as a held orbit", async () => {
    // `absent` is the subject answering, not the link failing: the widget owes the
    // operator the orbitless wording and none of the currency caption.
    const { fixture, view } = setup();
    act(() => {
      fixture.emit("system.bodies", { bodies: [SUN, EARTH, MARS] });
      fixture.emit("vessel.orbit", null);
    });
    await waitFor(() => expect(visibleText(view.container)).toMatch(NO_ORBIT));
    expect(visibleText(view.container)).not.toMatch(HELD_NOTE);
    expect(visibleText(view.container)).not.toContain(COLD_PLACEHOLDER);
  });
});
