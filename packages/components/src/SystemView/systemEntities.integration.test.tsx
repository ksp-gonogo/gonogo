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
import { SystemViewComponent } from "./index";
import type { SystemEntity } from "./systemEntities";

/**
 * End-to-end proof of the wiring `systemEntities.test.ts` /
 * `SystemEntitiesLayer.test.tsx` can't see: that a REAL `registerContribution`
 * against `system-view.entities`, aggregated through the widget's declared
 * `contributionSlots` (`GridItemContent.tsx`'s real path, mirrored here via
 * `WidgetMetaContext` + `ContributionsProvider`, same as `ShipMap/
 * contributions.test.tsx`), actually reaches the diagram as a drawn SVG
 * primitive. `contributionSlots` missing from `registerComponent` would pass
 * every unit test in this folder while leaving the slot permanently empty in
 * the live app: this is the test that would have caught it.
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
  componentId: "system-view",
  contributionSlots: ["system-view.entities"] as const,
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

describe("SystemView: system-view.entities contribution wiring", () => {
  // No `clearContributions()` teardown: the registry is this file's own
  // (vitest isolates per file), and clearing it notifies the aggregator while
  // the tree is still mounted, which re-renders outside act.
  it("draws a registered contribution's entity as an SVG primitive", async () => {
    registerContribution({
      id: "test-system-view-entity",
      contributes: "system-view.entities",
      compute: () => [ENTITY],
    });

    const fixture: StreamFixture = setupStreamFixture({
      carriedChannels: ["vessel.identity", "system.bodies"],
      pinnedUt: 100,
    });

    const { container } = render(
      <fixture.Provider>
        <WidgetMetaContext.Provider value={META}>
          <ContributionsProvider>
            <SystemViewComponent config={{}} id="sv" />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("system.bodies", kerbinSystem());
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
