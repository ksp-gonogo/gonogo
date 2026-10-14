import {
  ContributionsProvider,
  registerContribution,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { TrackingStationComponent } from "./index";
import type { SystemEntity } from "./systemEntities";

/**
 * A real `registerContribution` against `tracking-station.entities`, aggregated through the widget's declared `contributionSlots` as the dashboard does, reaches the diagram as a drawn SVG primitive.
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
    ],
  };
}

const META = {
  componentId: "tracking-station",
  contributionSlots: ["tracking-station.entities"] as const,
};

const ENTITY: SystemEntity = {
  id: "test-vessel-1",
  position: {
    kind: "fixed",
    parentName: "Kerbin",
    xMetres: 1_000_000,
    yMetres: 0,
    zMetres: 0,
  },
  shape: { kind: "point" },
  meta: { name: "Test Vessel" },
};

describe("TrackingStation: tracking-station.entities contribution wiring", () => {
  // No `clearContributions()` teardown: vitest isolates the registry per file, and clearing it would re-render the mounted tree outside act.
  it("draws a registered contribution's entity as an SVG primitive", async () => {
    registerContribution({
      id: "test-tracking-station-entity",
      contributes: "tracking-station.entities",
      compute: () => [ENTITY],
    });

    const fixture: StreamFixture = setupStreamFixture({
      pinnedUt: 100,
      suspendFrames: true,
    });

    const { container } = render(
      <fixture.Provider>
        <WidgetMetaContext.Provider value={META}>
          <ContributionsProvider>
            <TrackingStationComponent config={{}} id="sv" />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("trackingStation.bodies", kerbinSystem());
      fixture.emit("vessel.identity", {
        vesselId: "v",
        name: "Tester",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 0,
      });
    });

    await waitFor(() =>
      expect(screen.getAllByText("Kerbin").length).toBeGreaterThan(0),
    );

    await waitFor(() =>
      expect(
        container.querySelector('[data-entity-id="test-vessel-1"]'),
      ).not.toBeNull(),
    );
  });
});
