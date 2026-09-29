import { clearRegistry, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TransferWindowComponent } from "./index";

/**
 * What TransferWindow does when the parking orbit stops being current: it keeps
 * planning and marks the figures the orbit sets (the ejection and reach Δv)
 * held, since the dial, badge and countdowns ride the body catalogue. Held, cold and
 * confirmed-none each read differently from outside.
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

const COLD_PLACEHOLDER = "Waiting for vessel orbit...";
const NO_ORBIT = /No parking orbit/;

// Unmounted before clearRegistry, whose notification on a mounted widget lands outside act().
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

/** Drop the transport, so every carried topic's reading goes `held`. */
function loseTheLink(fixture: ReturnType<typeof setupStreamFixture>) {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

/** The figure beside a windows-list label, e.g. "Ejection Δv". */
function figureBeside(label: string): HTMLElement {
  const value = screen.getByText(label).nextElementSibling;
  if (!(value instanceof HTMLElement))
    throw new Error(`no figure beside ${label}`);
  return value;
}

/** Every reach-table "Δv needed" figure, one per destination row. */
function reachDeltaVFigures(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("tbody tr")].map(
    (row) => row.children[1],
  );
}

const isMarkedHeld = (figure: Element): boolean =>
  figure.querySelector("[data-held]") !== null &&
  figure.querySelector("[data-unit-currency]") !== null;

describe("TransferWindow when the parking orbit is held", () => {
  it("marks nothing held while the telemetry is current", async () => {
    // The control: without it the assertions below would pass on a widget that marks unconditionally or never plans.
    const { fixture, view } = setup();
    emitParked(fixture);
    await waitFor(() =>
      expect(screen.getByText("Current phase")).toBeInTheDocument(),
    );
    expect(isMarkedHeld(figureBeside("Ejection Δv"))).toBe(false);
    expect(view.container.querySelector("[data-held]")).toBeNull();
  });

  it("keeps the board drawn and marks the parking-orbit Δv figures held", async () => {
    const { fixture, view } = setup();
    emitParked(fixture);
    await waitFor(() =>
      expect(screen.getByText("Current phase")).toBeInTheDocument(),
    );

    loseTheLink(fixture);

    await waitFor(() =>
      expect(isMarkedHeld(figureBeside("Ejection Δv"))).toBe(true),
    );
    const reach = reachDeltaVFigures(view.container);
    expect(reach.length).toBeGreaterThan(0);
    for (const figure of reach) expect(isMarkedHeld(figure)).toBe(true);
    // Held, not withheld: the body-catalogue instruments stay, and no sentence stands in for the mark.
    expect(screen.getByText("Current phase")).toBeInTheDocument();
    expect(screen.getByText("IDEAL")).toBeInTheDocument();
    expect(screen.getByText(/^Windows to$/)).toBeInTheDocument();
  });

  it("does not fall back to either empty state, so held reads as neither cold nor orbitless", async () => {
    // Neither "Waiting for vessel orbit..." nor "No parking orbit" may be reached from a held reading.
    const { fixture, view } = setup();
    emitParked(fixture);
    await waitFor(() =>
      expect(screen.getByText("Current phase")).toBeInTheDocument(),
    );

    loseTheLink(fixture);

    await waitFor(() =>
      expect(isMarkedHeld(figureBeside("Ejection Δv"))).toBe(true),
    );
    expect(visibleText(view.container)).not.toContain(COLD_PLACEHOLDER);
    expect(visibleText(view.container)).not.toMatch(NO_ORBIT);
  });

  it("marks nothing held before anything has ever arrived", async () => {
    // A cold start is not a lost link.
    const { view } = setup();
    expect(await screen.findByText(COLD_PLACEHOLDER)).toBeInTheDocument();
    expect(view.container.querySelector("[data-held]")).toBeNull();
  });

  it("does not mark a confirmed tombstone as a held orbit", async () => {
    // `absent` is the subject answering, not the link failing: the orbitless wording and no held mark.
    const { fixture, view } = setup();
    act(() => {
      fixture.emit("system.bodies", { bodies: [SUN, EARTH, MARS] });
      fixture.emit("vessel.orbit", null);
    });
    await waitFor(() => expect(visibleText(view.container)).toMatch(NO_ORBIT));
    expect(view.container.querySelector("[data-held]")).toBeNull();
    expect(visibleText(view.container)).not.toContain(COLD_PLACEHOLDER);
  });
});
