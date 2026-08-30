import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";
// Side-effect import: registers the real `system-view-vessel-orbits`
// contribution (owns BOTH the fleet and the comms.network graph),
// same as `index.tsx` does for the live app.
import "./vesselOrbitsContribution";

/**
 * End-to-end proof for the CommNet relay graph half of the built-in
 * `system-view-vessel-orbits` contribution: a real `comms.network`
 * stream, a real `SystemViewComponent`, and the actual `SystemEntitiesLayer`
 * DOM it renders into, not a unit test of `computeCommsNetworkEntities` in
 * isolation.
 *
 * `system.bodies` here flags Kerbin `isHome: true`, the join the graph's
 * `"home"` node now resolves against, matching `multi-vessel-orbits.json`
 * and `vesselOrbitsContribution.test.ts`'s own `bodies()` fixture, unlike
 * the sibling `vesselOrbitsContribution.integration.test.tsx` file (whose
 * minimal two-body list carries no home flag at all, for a different,
 * home-agnostic purpose).
 */

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;

function kerbolSystem() {
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
        isHome: true,
        orbit: {
          sma: 13_599_840_256,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 3.14,
          epoch: 0,
        },
      },
      {
        index: 2,
        name: "Mun",
        parentIndex: 1,
        radius: 200_000,
        gravParameter: 6.5138398e10,
        orbit: {
          sma: 12_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 1.93228,
          epoch: 0,
        },
      },
    ],
  };
}

const META = {
  componentId: "system-view",
  contributionSlots: ["system-view.entities"] as const,
};

describe("SystemView: comms.network relay graph as faint connection lines", () => {
  it("draws a resolvable edge and omits an edge with an unresolvable endpoint", async () => {
    const fixture: StreamFixture = setupStreamFixture({
      carriedChannels: [
        "vessel.orbit",
        "vessel.identity",
        "system.bodies",
        "system.vessels",
        "comms.network",
      ],
      pinnedUt: 0,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <WidgetMetaContext.Provider value={META}>
          <ContributionsProvider>
            <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("system.bodies", kerbolSystem());
      fixture.emit("vessel.identity", {
        vesselId: "v-active",
        name: "Tester",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 1,
      });
      fixture.emit("vessel.orbit", {
        referenceBodyIndex: 1,
        sma: 700_000,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
        mu: KERBIN_MU,
      });
      fixture.emit("system.vessels", {
        vessels: [
          {
            vesselId: "v-active",
            name: "Tester",
            vesselType: 0,
            situation: 3,
            bodyIndex: 1,
            orbit: {
              sma: 700_000,
              ecc: 0,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 0,
            },
          },
          {
            vesselId: "v-relay",
            name: "Comsat Relay-1",
            vesselType: 6,
            situation: 3,
            bodyIndex: 1,
            orbit: {
              sma: 3_468_750,
              ecc: 0,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 0,
            },
          },
        ],
      });
      fixture.emit("comms.network", {
        nodes: [
          { id: "home", displayName: "KSC", kind: 0 },
          { id: "v-relay", displayName: "Comsat Relay-1", kind: 1 },
          { id: "v-active", displayName: "Tester", kind: 2 },
        ],
        edges: [
          { a: "home", b: "v-relay", active: true },
          // "v-ghost" never lands on system.vessels: this edge must be
          // omitted outright, never drawn from a fabricated position.
          { a: "v-relay", b: "v-ghost", active: true },
        ],
      });
    });

    await waitFor(() =>
      expect(screen.getAllByText("Kerbin").length).toBeGreaterThan(0),
    );

    const resolvedLine = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="comms-edge:home:v-relay"]',
      );
      expect(el).not.toBeNull();
      return el as SVGLineElement;
    });

    // Faint styling: the same emphasis/opacity every other faint contributed
    // entity (the vessel-orbit rings) resolves to.
    expect(resolvedLine.tagName.toLowerCase()).toBe("line");
    expect(resolvedLine.getAttribute("stroke")).toBe("var(--color-text-faint)");
    expect(resolvedLine.getAttribute("stroke-opacity")).toBe("0.5");

    // The unresolvable edge never renders, honest omission rather than a
    // fabricated endpoint.
    expect(
      container.querySelector('[data-entity-id="comms-edge:v-relay:v-ghost"]'),
    ).toBeNull();
  });
});
