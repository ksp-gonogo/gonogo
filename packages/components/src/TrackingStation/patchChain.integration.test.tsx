import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TrackingStationComponent } from "./index";

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

function mount(
  patches: readonly unknown[],
  recordPlacedAt?: number,
  opts: { ut?: number; targetSma?: number } = {},
) {
  const fixture = setupStreamFixture({
    pinnedUt: opts.ut ?? 0,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <TrackingStationComponent
        config={{ frame: "Kerbin" } as never}
        id="sv-chain"
        w={10}
        h={12}
      />
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("trackingStation.bodies", system());
    fixture.emit("vessel.identity", {
      vesselId: "v-active",
      name: "Active Craft",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: 1,
    });
    fixture.emit("vessel.orbit", { ...NO_ENCOUNTER_ORBIT, patches });
    if (opts.targetSma !== undefined) {
      fixture.emit("vessel.target", {
        name: "Relay",
        kind: 0,
        vesselId: "v-relay",
        bodyIndex: null,
        relativePosition: { x: 0, y: 0, z: 0 },
        relativeVelocity: { x: 0, y: 0, z: 0 },
        orbit: {
          ...NO_ENCOUNTER_ORBIT,
          ecc: 0,
          sma: opts.targetSma,
          patches: [],
        },
      });
    }
    if (recordPlacedAt !== undefined) {
      fixture.emit("trackingStation.catalog", {
        entries: [
          {
            vesselId: "v-active",
            name: "Active Craft",
            vesselType: 0,
            situation: 3,
            bodyIndex: 1,
            placeAsOfUt: recordPlacedAt,
            orbit: { ...NO_ENCOUNTER_ORBIT, sma: 4_000_000 },
          },
        ],
      });
    }
  });
  return view;
}

/** Every predicted arc, which the diagram draws in the accent stroke apart from the craft's own curve. */
function predictedArcs(container: HTMLElement): Element[] {
  return Array.from(
    container.querySelectorAll(
      'path[stroke][fill="none"]:not([data-vessel-trajectory]):not([data-body-orbit]):not([data-route-held-hit])',
    ),
  ).filter((el) => (el.getAttribute("d") ?? "").length > 0);
}

describe("TrackingStation's predicted patch chain", () => {
  it("marks an encounter, with an arc about the body, from the patches the game published", async () => {
    const view = mount([
      wirePatch("Kerbin", 0, ENCOUNTER_UT, 0, 3_000_000),
      wirePatch("Mun", ENCOUNTER_UT, 60_000, 2, 400_000),
    ]);
    await waitFor(() => {
      expect(view.container.textContent).toContain("→ Mun");
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

  it("draws the chain held, and none of it as live, when the record placing the craft is newer than its report", async () => {
    const view = mount(
      [
        wirePatch("Kerbin", 0, ENCOUNTER_UT, 0, 3_000_000),
        wirePatch("Mun", ENCOUNTER_UT, 60_000, 2, 400_000),
      ],
      500,
    );
    await waitFor(() => {
      expect(
        view.container.querySelector('[data-vessel-placed-by="record"]'),
      ).not.toBeNull();
    });
    const arcs = predictedArcs(view.container);
    expect(arcs.length).toBeGreaterThan(0);
    for (const arc of arcs) {
      expect(arc.closest("[data-route-held]")).not.toBeNull();
    }
    const reasons = [
      ...view.container.querySelectorAll("[data-route-held-hit] title"),
    ].map((t) => t.textContent);
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(reason).toMatch(/^Held: last report .+ ago$/);
    }
    for (const marker of view.container.querySelectorAll(
      '[data-encounter-subject="vessel"]',
    )) {
      expect(marker.hasAttribute("data-route-held")).toBe(true);
      expect(marker.querySelector("title")?.textContent).toMatch(
        /^Held: last report/,
      );
    }
    expect(
      view.container.querySelector("[data-held-plan-caption]")?.textContent,
    ).toMatch(/held from the craft's report/);
    await act(async () => {});
  });

  describe("beside a target", () => {
    const chain = [
      wirePatch("Kerbin", 0, ENCOUNTER_UT, 0, 3_000_000),
      wirePatch("Mun", ENCOUNTER_UT, 60_000, 2, 400_000),
    ];

    it("marks where the target was at the report, and keeps the held encounter while the report is younger than the target's orbit", async () => {
      const view = mount(chain, 500, { ut: 1000, targetSma: 3_000_000 });
      await waitFor(() => {
        expect(
          view.container.querySelector("[data-target-then]"),
        ).not.toBeNull();
      });
      expect(
        view.container.querySelector("[data-target-then] title")?.textContent,
      ).toMatch(/^Relay at the craft's report\. Held: last report/);
      expect(
        view.container.querySelector('[data-encounter-subject="vessel"]'),
      ).not.toBeNull();
      expect(
        view.container.querySelector("[data-held-plan-caption]")?.textContent,
      ).toMatch(/^Route and encounters held/);
      await act(async () => {});
    });

    it("hides the held encounter once the report is older than one orbit of the target, and keeps the target's place at the report", async () => {
      // Period of a 3 000 km orbit about Kerbin is about 17 400 s.
      const view = mount(chain, 500, { ut: 40_000, targetSma: 3_000_000 });
      await waitFor(() => {
        expect(
          view.container.querySelector("[data-target-then]"),
        ).not.toBeNull();
      });
      expect(
        view.container.querySelector('[data-encounter-subject="vessel"]'),
      ).toBeNull();
      expect(
        view.container.querySelector("[data-held-plan-caption]")?.textContent,
      ).toMatch(/^Route held from/);
      await act(async () => {});
    });

    it("draws no place at the report when the craft is not placed by a newer record", async () => {
      const view = mount(chain, undefined, { ut: 1000, targetSma: 3_000_000 });
      await waitFor(() => {
        expect(view.container.querySelector("svg")).not.toBeNull();
      });
      expect(view.container.querySelector("[data-target-then]")).toBeNull();
      await act(async () => {});
    });
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
