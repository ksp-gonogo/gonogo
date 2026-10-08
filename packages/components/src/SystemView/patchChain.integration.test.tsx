import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

/**
 * The predicted chain is the one the game published on `vessel.orbit.patches`, drawn about each body where it is when the patch begins: an encounter shows as a marker on the arc about the body, and nothing about it is made up from the single orbit.
 */

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;
const ENCOUNTER_UT = 30_000;

const NO_ENCOUNTER_ORBIT = {
  referenceBodyIndex: 1,
  sma: 3_000_000,
  ecc: 0.1,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
  mu: KERBIN_MU,
  horizon: { kind: 1, trajectoryKind: 1 },
};

function system() {
  return {
    bodies: [
      {
        index: 0,
        name: "Kerbol",
        parentIndex: null,
        radius: 261_600_000,
        gravParameter: KERBOL_MU,
        orbit: null,
      },
      {
        index: 1,
        name: "Kerbin",
        parentIndex: 0,
        radius: 600_000,
        gravParameter: KERBIN_MU,
        sphereOfInfluence: 84_159_286,
        orbit: {
          sma: 13_599_840_256,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 0,
        },
      },
      {
        index: 2,
        name: "Mun",
        parentIndex: 1,
        radius: 200_000,
        gravParameter: 6.5138398e10,
        sphereOfInfluence: 2_429_559,
        orbit: {
          sma: 12_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 0,
        },
      },
    ],
  };
}

/** A patch as the wire carries it, around `body`, over its window. */
function wirePatch(
  body: string,
  startUt: number,
  endUt: number,
  startTransition: number,
  sma: number,
) {
  return {
    startUt,
    endUt,
    patchStartTransition: startTransition,
    patchEndTransition: 1,
    sma,
    ecc: 0.1,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: startUt,
    period: 20_000,
    peA: sma * 0.9,
    apA: sma * 1.1,
    semiLatusRectum: sma,
    semiMinorAxis: sma,
    referenceBody: body,
    closestEncounterBody: null,
  };
}

function mount(patches: readonly unknown[]) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <SystemViewComponent
        config={{ frame: "Kerbin" } as never}
        id="sv-chain"
        w={10}
        h={12}
      />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", system());
    fixture.emit("vessel.identity", {
      vesselId: "v-active",
      name: "Active Craft",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: 1,
    });
    fixture.emit("vessel.orbit", { ...NO_ENCOUNTER_ORBIT, patches });
  });
  return view;
}

/** Every predicted arc, which the diagram draws in the accent stroke apart from the craft's own curve. */
function predictedArcs(container: HTMLElement): Element[] {
  return Array.from(
    container.querySelectorAll(
      'path[stroke][fill="none"]:not([data-vessel-trajectory]):not([data-body-orbit])',
    ),
  ).filter((el) => (el.getAttribute("d") ?? "").length > 0);
}

describe("SystemView's predicted patch chain", () => {
  it("marks an encounter, with an arc about the body, from the patches the game published", async () => {
    const view = mount([
      wirePatch("Kerbin", 0, ENCOUNTER_UT, 0, 3_000_000),
      wirePatch("Mun", ENCOUNTER_UT, 60_000, 2, 400_000),
    ]);
    await waitFor(() => {
      expect(view.container.textContent).toContain("↳ Mun");
    });
    await act(async () => {});
  });

  it("marks an escape the same way", async () => {
    const view = mount([
      wirePatch("Kerbin", 0, ENCOUNTER_UT, 0, 3_000_000),
      wirePatch("Kerbol", ENCOUNTER_UT, 60_000, 3, 13_599_840_256),
    ]);
    await waitFor(() => {
      expect(view.container.textContent).toContain("escape Kerbol");
    });
    await act(async () => {});
  });

  it("draws no prediction when the game published no chain, rather than making one from the orbit", async () => {
    const view = mount([]);
    await waitFor(() => {
      expect(view.container.querySelector("svg")).not.toBeNull();
    });
    expect(view.container.textContent).not.toContain("↳");
    expect(predictedArcs(view.container)).toHaveLength(0);
    await act(async () => {});
  });
});
