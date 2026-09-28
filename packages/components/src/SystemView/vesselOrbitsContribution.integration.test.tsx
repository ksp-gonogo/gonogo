import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";
// Registers the real contribution.
import "./vesselOrbitsContribution";

/** The active vessel gets no faint contributed entry of its own, since SystemDiagram already draws its bright ring beneath the entities layer. */

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
      // A child body, so SystemDiagram draws the diagram and the vessel's bright ring rather than its placeholder.
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

    // The active vessel's own bright ring, drawn by SystemDiagram, is present exactly once.
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

    // The active vessel's contributed faint entry is suppressed.
    expect(
      container.querySelector('[data-entity-id="vessel-orbit:v-active"]'),
    ).toBeNull();
  });

  it("does NOT suppress the active vessel's faint contributed entry when vessel.orbit is absent (identity alone doesn't imply a dedicated ring)", async () => {
    // With identity but no `vessel.orbit`, SystemDiagram draws no dedicated ring, so the contributed faint one must stay or the hop endpoint has no marker.
    const fixture: StreamFixture = setupStreamFixture({
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
