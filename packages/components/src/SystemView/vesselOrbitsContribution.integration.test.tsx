import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";
// Side-effect import: registers the real `system-view-vessel-orbits`
// contribution, same as `index.tsx` does for the live app.
import "./vesselOrbitsContribution";

/**
 * Fix-round-1 regression for the faint-vessel-orbit contribution
 * (`e13033f8`): the active/framed vessel must not get its own faint entry
 * from `system-view-vessel-orbits`. `SystemDiagram` already draws that
 * vessel's dedicated bright ring, and `SystemEntitiesLayer` renders above
 * it, so an unsuppressed faint duplicate sits visually on top of the bright
 * one. `index.tsx` filters the aggregated entities by `vesselId` against
 * `vessel.identity` before handing them to `SystemEntitiesLayer`; this is
 * the end-to-end proof (real contribution + real SystemView, not a unit
 * test of `computeVesselOrbitEntities` in isolation).
 */

const KERBIN_MU = 3.5316e12;

function kerbinSystem() {
  return {
    bodies: [
      {
        index: 0,
        name: "Kerbin",
        parentIndex: null,
        radius: 600_000,
        gravParameter: KERBIN_MU,
        sphereOfInfluence: 84_159_286,
        orbit: null,
      },
      // SystemDiagram needs at least one child body to draw its own diagram
      // (and the active vessel's bright ring) instead of the "no bodies
      // orbiting" placeholder; the entities layer renders independently of
      // that, so the earlier single-body fixture in
      // systemEntities.integration.test.tsx didn't need this.
      {
        index: 1,
        name: "Mun",
        parentIndex: 0,
        radius: 200_000,
        gravParameter: 6.5138398e10,
        orbit: {
          sma: 12_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 100,
        },
      },
    ],
  };
}

const META = {
  componentId: "system-view",
  contributionSlots: ["system-view.entities"] as const,
};

describe("SystemView: active vessel excluded from its own faint orbit contribution", () => {
  it("draws a faint ring for another vessel but none for the active/framed vessel", async () => {
    const fixture: StreamFixture = setupStreamFixture({
      carriedChannels: [
        "vessel.orbit",
        "vessel.identity",
        "system.bodies",
        "system.vessels",
      ],
      pinnedUt: 100,
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
      fixture.emit("system.bodies", kerbinSystem());
      fixture.emit("vessel.identity", {
        vesselId: "v-active",
        name: "Tester",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 0,
      });
      fixture.emit("vessel.orbit", {
        referenceBodyIndex: 0,
        sma: 700_000,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 100,
        mu: KERBIN_MU,
      });
      fixture.emit("system.vessels", {
        vessels: [
          {
            vesselId: "v-active",
            name: "Tester",
            vesselType: 0,
            situation: 3,
            bodyIndex: 0,
            orbit: {
              sma: 700_000,
              ecc: 0,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 100,
            },
          },
          {
            vesselId: "v-other",
            name: "Other Ship",
            vesselType: 0,
            situation: 3,
            bodyIndex: 0,
            orbit: {
              sma: 5_000_000,
              ecc: 0.2,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 100,
            },
          },
        ],
      });
    });

    await waitFor(() =>
      expect(screen.getAllByText("Kerbin").length).toBeGreaterThan(0),
    );

    // The active vessel's own bright ring (SystemDiagram's own render, not
    // the contribution) is present exactly once.
    await waitFor(() =>
      expect(
        container.querySelectorAll('circle[fill="var(--color-accent-fg)"]'),
      ).toHaveLength(1),
    );

    // The other vessel's faint contributed orbit ring is present.
    await waitFor(() =>
      expect(
        container.querySelector('[data-entity-id="vessel-orbit:v-other"]'),
      ).not.toBeNull(),
    );

    // The active vessel's own faint contributed entry is suppressed: no
    // duplicate ring sitting on top of the bright one.
    expect(
      container.querySelector('[data-entity-id="vessel-orbit:v-active"]'),
    ).toBeNull();
  });

  it("does NOT suppress the active vessel's faint contributed entry when vessel.orbit is absent (identity alone doesn't imply a dedicated ring)", async () => {
    // Round-4 regression: a caller can legitimately carry `vessel.identity`
    // (command traffic needs it to know which vessel it's routing to)
    // without `vessel.orbit` (e.g. the traffic capture fixture, which
    // withholds it to avoid SystemDiagram's own accent-green predicted-
    // trajectory patch). With no orbit, `SystemDiagram` never draws a
    // dedicated ring for that vessel, so suppressing the contributed faint
    // one too left the hop endpoint with NO marker at all.
    const fixture: StreamFixture = setupStreamFixture({
      carriedChannels: ["vessel.identity", "system.bodies", "system.vessels"],
      pinnedUt: 100,
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
      fixture.emit("system.bodies", kerbinSystem());
      fixture.emit("vessel.identity", {
        vesselId: "v-active",
        name: "Tester",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 0,
      });
      fixture.emit("system.vessels", {
        vessels: [
          {
            vesselId: "v-active",
            name: "Tester",
            vesselType: 0,
            situation: 3,
            bodyIndex: 0,
            orbit: {
              sma: 700_000,
              ecc: 0,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 100,
            },
          },
        ],
      });
    });

    await waitFor(() =>
      expect(
        container.querySelector('[data-entity-id="vessel-orbit:v-active"]'),
      ).not.toBeNull(),
    );
  });
});
