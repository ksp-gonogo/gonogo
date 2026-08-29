import {
  ContributionsProvider,
  getAugmentsForSlot,
  getContributionsForSlot,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SystemViewComponent } from "../SystemView";
// Side-effect import: registers the real `system-view-vessel-orbits`
// contribution (the fleet plus the comms.network relay graph), the same
// shape-contribution model the Commlinks/Traffic toggles below now gate,
// matching `commsNetworkContribution.integration.test.tsx` and
// `commsTraffic.integration.test.tsx`'s own style.
import "../SystemView/vesselOrbitsContribution";
import { UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
// Importing the augment module registers it ONCE, at this file's first
// import (module-load self-registration, same lifecycle as
// `registerComponent`): deliberately NOT cleared with `clearAugments()`
// between tests the way `SystemView/slot.test.tsx` clears its ad-hoc,
// per-test test-augments: there is nothing here to re-register between
// tests, so clearing would just permanently empty the slot after the
// first `it()`.
import "./index";
import { __resetFleetCommsTogglesForTests } from "./toggles";

const KERBIN_MU = 3.5316e12;

const META = {
  componentId: "system-view",
  contributionSlots: ["system-view.entities"] as const,
};

/**
 * Integration coverage for the Fleet/Comms augment after its comms drawing
 * moved onto the contribution model. The `system-view.overlay` fill that used
 * to draw its own straight-line comms path and command-traffic pulse is gone,
 * superseded by the CommNet relay graph, the selected-path highlight and the
 * graph-routed traffic pulses `SystemView`'s own `SystemEntitiesLayer` draws.
 *
 * This file proves what is left: the augment registers `.actions` and
 * nothing else, the two toggles gate that model's connection-line and pulse
 * entities rather than a second draw of their own, and the route and pulse
 * each render EXACTLY ONCE with the toggles on, which is what would catch
 * the duplicate draw coming back. The header link badge is a contribution
 * now, covered end to end by `./panel-badge.test.tsx`.
 */
describe("FleetComms: actions augment on SystemView, comms drawing on the contribution model", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    __resetFleetCommsTogglesForTests();
    fixture = setupStreamFixture({
      carriedChannels: [
        "vessel.orbit",
        "vessel.identity",
        "system.bodies",
        "system.vessels",
        "comms.network",
        "comms.link",
        "system.uplink.pending",
      ],
      pinnedUt: 100,
    });
  });

  /** Mounts SystemView framed on Kerbin with one active vessel directly
   *  linked to home over one edge: the minimal scene a comms line needs a
   *  route to draw on, wrapped in the real contribution providers the
   *  shape-contribution model requires. */
  async function renderDiagram() {
    const result = render(
      <fixture.Provider>
        <WidgetMetaContext.Provider value={META}>
          <ContributionsProvider>
            <SystemViewComponent config={{ frame: "Kerbin" }} id="sv" />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      // Kerbin carries `isHome`, which is what the graph's `"home"` node
      // resolves against: without a flagged body there is no honest position
      // for the ground station and the edge is omitted rather than guessed.
      fixture.emit("system.bodies", {
        bodies: [
          {
            index: 0,
            name: "Kerbol",
            parentIndex: null,
            radius: 261_600_000,
            gravParameter: 1.1723328e18,
            orbit: null,
          },
          {
            index: 1,
            name: "Kerbin",
            parentIndex: 0,
            radius: 600_000,
            gravParameter: KERBIN_MU,
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
      });
      fixture.emit("vessel.identity", {
        vesselId: "v-active",
        name: "Test Ship",
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
        epoch: 100,
        mu: KERBIN_MU,
        horizon: UNBOUNDED_HORIZON,
      });
      fixture.emit("system.vessels", {
        vessels: [
          {
            vesselId: "v-active",
            name: "Test Ship",
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
              epoch: 100,
            },
          },
        ],
      });
      fixture.emit("comms.network", {
        nodes: [
          { id: "home", displayName: "KSC", kind: 0 },
          { id: "v-active", displayName: "Test Ship", kind: 2 },
        ],
        edges: [{ a: "home", b: "v-active", active: true }],
      });
    });
    await waitFor(() =>
      expect(screen.getAllByText("Kerbin").length).toBeGreaterThanOrEqual(1),
    );
    return result;
  }

  it("registers the actions augment and no overlay fill: the old straight-line draw is gone", () => {
    const overlay = getAugmentsForSlot("system-view.overlay");
    const actions = getAugmentsForSlot("system-view.actions");
    expect(overlay.map((a) => a.id)).not.toContain("fleet-comms-overlay");
    expect(actions.map((a) => a.id)).toContain("fleet-comms-actions");
  });

  it("no longer registers a badges augment", () => {
    expect(getAugmentsForSlot("system-view.badges")).toEqual([]);
  });

  // The contribution IS registered, by importing `./index` above (which
  // side-effect imports `./badge`). Proves the two halves stay wired together
  // without this file having to import the badge module itself.
  it("registers the badge as a contribution on the same slot id", () => {
    // `core:`-prefixed: a contribution id is stamped with its owning client,
    // and the built-in half registers through `CORE_UPLINK_CLIENT`.
    expect(
      getContributionsForSlot("system-view.badges").map((c) => c.id),
    ).toContain("core:fleet-comms-badge");
  });

  it("draws the active vessel's comms route exactly once, via the shape-contribution graph", async () => {
    const { container } = await renderDiagram();
    await waitFor(() => {
      expect(
        container.querySelectorAll(
          '[data-entity-id="comms-edge:home:v-active"]',
        ),
      ).toHaveLength(1);
    });
    // No second, FleetComms-drawn line anywhere in the tree: the only
    // `<line>` element is the one contributed edge.
    expect(container.querySelectorAll("line")).toHaveLength(1);
  });

  it("hides the comms route when the Commlinks toggle is switched off, and restores it when switched back on", async () => {
    const user = userEvent.setup();
    const { container } = await renderDiagram();
    await waitFor(() =>
      expect(
        container.querySelector('[data-entity-id="comms-edge:home:v-active"]'),
      ).not.toBeNull(),
    );

    const commlinksButton = screen.getByRole("button", { name: "Commlinks" });
    expect(commlinksButton.getAttribute("aria-pressed")).toBe("true");
    await user.click(commlinksButton);
    expect(commlinksButton.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => {
      expect(
        container.querySelector('[data-entity-id="comms-edge:home:v-active"]'),
      ).toBeNull();
    });

    await user.click(commlinksButton);
    expect(commlinksButton.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => {
      expect(
        container.querySelector('[data-entity-id="comms-edge:home:v-active"]'),
      ).not.toBeNull();
    });
  });

  it("draws a pending-uplink pulse exactly once while the Traffic toggle is on, and none once switched off", async () => {
    const user = userEvent.setup();
    const { container } = await renderDiagram();
    act(() => {
      fixture.emit(
        "system.uplink.pending",
        {
          pending: [
            {
              id: "cmd-1",
              command: "vessel.control.setActionGroup",
              label: "",
              topic: "vessel/1",
              vantage: "KSC",
              dispatchedAt: 90,
              oneWaySeconds: 1_000_000,
            },
          ],
        },
        { deliveredAt: 95 },
      );
    });

    await waitFor(() => {
      expect(
        container.querySelectorAll(
          '[data-pulse-edge-id="comms-edge:home:v-active"]',
        ),
      ).toHaveLength(1);
    });

    const trafficButton = screen.getByRole("button", { name: "Traffic" });
    expect(trafficButton.getAttribute("aria-pressed")).toBe("true");
    await user.click(trafficButton);
    expect(trafficButton.getAttribute("aria-pressed")).toBe("false");
    await waitFor(() => {
      expect(container.querySelector("[data-pulse-edge-id]")).toBeNull();
    });
  });

  it("has no axe violations with the actions augment and the contributed graph rendered", async () => {
    const { container } = await renderDiagram();
    await waitFor(() =>
      expect(
        container.querySelector('[data-entity-id="comms-edge:home:v-active"]'),
      ).not.toBeNull(),
    );
    await expectNoA11yViolations(container);
  });
});
