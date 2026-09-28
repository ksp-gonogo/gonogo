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
// Side-effect import: registers the real `system-view-vessel-orbits` contribution the toggles gate.
import "../SystemView/vesselOrbitsContribution";
import { UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
// The augment self-registers once at import, so it is deliberately not cleared between tests.
import "./index";
import { __resetFleetCommsTogglesForTests } from "./toggles";

const KERBIN_MU = 3.5316e12;

const META = {
  componentId: "system-view",
  contributionSlots: ["system-view.entities"] as const,
};

/**
 * The Fleet/Comms augment registers `.actions` and nothing else, its toggles
 * gate SystemView's own connection-line and pulse entities, and the route and
 * pulse each render EXACTLY ONCE with the toggles on.
 */
describe("FleetComms: actions augment on SystemView, comms drawing on the contribution model", () => {
  let fixture: StreamFixture;

  beforeEach(() => {
    __resetFleetCommsTogglesForTests();
    fixture = setupStreamFixture({
      suspendFrames: true,
      pinnedUt: 100,
    });
  });

  /** SystemView framed on Kerbin with one active vessel linked directly home: the minimal scene a comms line can draw on. */
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
      // Without an `isHome` body the ground station has no honest position and the edge is omitted.
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

  // Registered by importing `./index`, which proves the badge stays wired to the augment module.
  it("registers the badge as a contribution on the same slot id", () => {
    // A contribution id is stamped with its owning client.
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
    // The only `<line>` element is the one contributed edge.
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
