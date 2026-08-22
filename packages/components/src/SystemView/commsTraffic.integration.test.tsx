import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";
// Side-effect import: registers the real `system-view-vessel-orbits`
// contribution (fleet + comms.network graph), same as `index.tsx` does for
// the live app, matching `selection.integration.test.tsx`'s own style.
import "./vesselOrbitsContribution";

/**
 * Command traffic: `system.uplink.pending` entries render as pulses
 * riding the ACTIVE vessel's `comms.network` route, end to end against a
 * real `SystemViewComponent`, a real stream, and the real DOM
 * `SystemEntitiesLayer` renders (not `deriveTraffic` in isolation, that's
 * `commsTraffic.test.ts`).
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
    ],
  };
}

const META = {
  componentId: "system-view",
  contributionSlots: ["system-view.entities"] as const,
};

/** Mounts SystemViewComponent framed on Kerbin, with a single active vessel
 *  directly linked to home over one edge: the minimal scene a traffic pulse
 *  needs a route to travel on. `pending` is the `system.uplink.pending`
 *  queue to emit, or omitted to exercise the no-traffic case. */
function mountScene(pending?: unknown[]) {
  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: [
      "vessel.orbit",
      "vessel.identity",
      "system.bodies",
      "system.vessels",
      "comms.network",
      "system.uplink.pending",
    ],
    pinnedUt: 0,
  });

  const view = render(
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
      name: "Active Craft",
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
          name: "Active Craft",
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
      ],
    });
    fixture.emit("comms.network", {
      nodes: [
        { id: "home", displayName: "KSC", kind: 0 },
        { id: "v-active", displayName: "Active Craft", kind: 2 },
      ],
      edges: [{ a: "home", b: "v-active", active: true }],
    });
    if (pending !== undefined) {
      fixture.emit("system.uplink.pending", { pending });
    }
  });

  return { container: view.container, fixture };
}

async function waitForRendered() {
  await waitFor(() =>
    expect(screen.getAllByText("Kerbin").length).toBeGreaterThan(0),
  );
}

describe("SystemView command traffic: system.uplink.pending as edge pulses", () => {
  it("renders no pulse and leaves the route faint when the pending queue is empty", async () => {
    const { container } = mountScene([]);
    await waitForRendered();

    const edge = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="comms-edge:home:v-active"]',
      );
      expect(el).not.toBeNull();
      return el as SVGLineElement;
    });
    expect(edge.getAttribute("stroke")).toBe("var(--color-text-faint)");
    expect(container.querySelector("[data-pulse-edge-id]")).toBeNull();
  });

  it("renders no pulse when system.uplink.pending has never delivered a sample", async () => {
    const { container } = mountScene(undefined);
    await waitForRendered();
    expect(container.querySelector("[data-pulse-edge-id]")).toBeNull();
  });

  it("renders a pulse on the active vessel's route and brightens it, for an in-flight entry", async () => {
    // A huge oneWaySeconds means the round trip (2 * oneWaySeconds) safely
    // covers any utNow the fake wall clock produces at dispatchedAt: 0, so
    // this proves the WIRING (pending -> route -> pulse) without pinning
    // down the exact clock formula (that's `commsTraffic.test.ts`'s job).
    const { container } = mountScene([
      {
        id: "cmd-1",
        command: "kos.run",
        label: "Deploy solar panels",
        topic: "",
        vantage: "ksc",
        dispatchedAt: 0,
        oneWaySeconds: 1_000_000,
      },
    ]);
    await waitForRendered();

    const pulse = await waitFor(() => {
      const el = container.querySelector(
        '[data-pulse-edge-id="comms-edge:home:v-active"]',
      );
      expect(el).not.toBeNull();
      return el as SVGCircleElement;
    });
    expect(pulse.getAttribute("fill")).toBe("var(--color-accent-fg)");

    // The traversed edge brightens while traffic is in flight on it.
    const edge = container.querySelector(
      '[data-entity-id="comms-edge:home:v-active"]',
    );
    expect(edge?.getAttribute("stroke")).toBe("var(--color-accent-fg)");
  });

  it("clears the pulse and re-fades the route once the pending entry ages out", async () => {
    const { container, fixture } = mountScene([
      {
        id: "cmd-1",
        command: "kos.run",
        label: "Deploy solar panels",
        topic: "",
        vantage: "ksc",
        dispatchedAt: 0,
        oneWaySeconds: 1_000_000,
      },
    ]);
    await waitForRendered();
    await waitFor(() =>
      expect(
        container.querySelector(
          '[data-pulse-edge-id="comms-edge:home:v-active"]',
        ),
      ).not.toBeNull(),
    );

    act(() => {
      fixture.emit("system.uplink.pending", { pending: [] });
    });

    await waitFor(() =>
      expect(container.querySelector("[data-pulse-edge-id]")).toBeNull(),
    );
    const edge = container.querySelector(
      '[data-entity-id="comms-edge:home:v-active"]',
    );
    expect(edge?.getAttribute("stroke")).toBe("var(--color-text-faint)");
  });
});
