import { clearRegistry, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TransferWindowComponent } from "./index";

/**
 * The phase angle between two planets is computed from their orbits and the
 * clock alone. Under stock physics those orbits are fixed conics, so the angle
 * is exact however long ago the catalogue arrived and takes no mark. Under an
 * n-body install a body's horizon is bounded, its elements drift, and the same
 * angle is only as current as the poses it rests on: it is marked held with
 * the catalogue, and held as of a body's horizon once the instant passes it.
 */

const DEG = Math.PI / 180;

/** `PropagationHorizonKind` and `TrajectoryKind` as the wire carries them. */
const ANALYTIC = { kind: 1, trajectoryKind: 1, untilUt: null };
const INTEGRATED = { kind: 2, trajectoryKind: 2, untilUt: 86_400 };

type Horizon = typeof ANALYTIC | typeof INTEGRATED;

const SUN = {
  index: 0,
  name: "Sun",
  gravParameter: 1.32712440018e20,
  radius: 6.957e8,
};

function earth(horizon: Horizon) {
  return {
    index: 1,
    name: "Earth",
    parentIndex: 0,
    gravParameter: 3.986004418e14,
    radius: 6.371e6,
    horizon,
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
}

function mars(horizon: Horizon) {
  return {
    index: 2,
    name: "Mars",
    parentIndex: 0,
    gravParameter: 4.282837e13,
    radius: 3.3895e6,
    horizon,
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
}

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

function setup(earthHorizon: Horizon, marsHorizon: Horizon, pinnedUt = 0) {
  const fixture = setupStreamFixture({ pinnedUt, suspendFrames: true });
  const view = renderTracked(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "transfer-exact" }}>
        <TransferWindowComponent
          id="transfer-exact"
          config={{ showPorkchop: true }}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    // The catalogue's last sample is for UT 0, so a later view instant is past it.
    fixture.emit(
      "system.bodies",
      { bodies: [SUN, earth(earthHorizon), mars(marsHorizon)] },
      { validAt: 0 },
    );
    fixture.emit("vessel.orbit", LEO);
  });
  return { fixture, view };
}

/** Drop the transport, so every carried topic's reading goes `held`. */
function loseTheLink(fixture: ReturnType<typeof setupStreamFixture>) {
  act(() => {
    fixture.store.setTransportConnected(false);
    fixture.store.beginFrame();
  });
}

/** The current phase angle between the origin and destination planets, the first figure under its label. */
async function currentPhase(): Promise<HTMLElement> {
  const label = await screen.findByText("Current phase");
  const facts = label.parentElement?.parentElement;
  const figure = facts?.querySelector("[data-figure]");
  if (!(figure instanceof HTMLElement)) {
    throw new Error("no figure under Current phase");
  }
  return figure;
}

const isMarked = (figure: HTMLElement): boolean =>
  figure.closest("[data-held]") !== null ||
  figure.querySelector("[data-held]") !== null;

describe("TransferWindow's planet-to-planet phase angle", () => {
  it("is unmarked under stock, live", async () => {
    setup(ANALYTIC, ANALYTIC);
    const figure = await currentPhase();
    expect(isMarked(figure)).toBe(false);
    expect(figure).toHaveAttribute("data-figure", "deterministic");
  });

  it("stays unmarked under stock after the link drops, since fixed conics and the clock need no observation", async () => {
    const { fixture } = setup(ANALYTIC, ANALYTIC);
    await currentPhase();
    loseTheLink(fixture);
    // The craft's own figures do go held, which proves the link really dropped.
    await waitFor(() =>
      expect(
        screen
          .getByText("Ejection Δv")
          .nextElementSibling?.querySelector("[data-held]"),
      ).not.toBeNull(),
    );
    const figure = await currentPhase();
    expect(isMarked(figure)).toBe(false);
    expect(figure).toHaveAttribute("data-figure", "deterministic");
  });

  it("is unmarked while current under an n-body install, but claims no exactness", async () => {
    setup(INTEGRATED, INTEGRATED);
    const figure = await currentPhase();
    expect(isMarked(figure)).toBe(false);
    expect(figure).toHaveAttribute("data-figure", "");
  });

  it("is marked held with the catalogue once a body's horizon is bounded", async () => {
    const { fixture } = setup(INTEGRATED, INTEGRATED, 1_000);
    await currentPhase();
    loseTheLink(fixture);
    await waitFor(async () =>
      expect(isMarked(await currentPhase())).toBe(true),
    );
  });

  it("takes one drifting body to lose the exactness, whichever of the two it is", async () => {
    const { fixture } = setup(ANALYTIC, INTEGRATED, 1_000);
    await currentPhase();
    loseTheLink(fixture);
    await waitFor(async () =>
      expect(isMarked(await currentPhase())).toBe(true),
    );
  });

  it("is marked held, link up, once the instant is past a body's horizon", async () => {
    setup(ANALYTIC, INTEGRATED, 200_000);
    const figure = await currentPhase();
    expect(isMarked(figure)).toBe(true);
  });

  it("stays exact past the same instant under stock, which has no horizon to pass", async () => {
    setup(ANALYTIC, ANALYTIC, 200_000);
    const figure = await currentPhase();
    expect(isMarked(figure)).toBe(false);
    expect(figure).toHaveAttribute("data-figure", "deterministic");
  });
});
