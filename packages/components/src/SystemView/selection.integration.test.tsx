import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";
// Registers the real contribution, so selection runs the whole pipeline.
import "./vesselOrbitsContribution";

/** Selecting a vessel brightens its orbit, highlights its CommNet path home coloured by control quality, and swaps the info panel to its roster meta. */

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

function orbit(sma: number) {
  return {
    sma,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
  };
}

const META = {
  componentId: "system-view",
  contributionSlots: ["system-view.entities"] as const,
};

/** Mounts SystemViewComponent on Kerbin with the active vessel (excluded from the layer) plus a one-hop (v-direct), a relayed two-hop (v-relayed) and an unreachable (v-isolated) vessel. */
function mountScene() {
  const fixture: StreamFixture = setupStreamFixture({
    pinnedUt: 0,
    suspendFrames: true,
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
          orbit: orbit(700_000),
        },
        {
          vesselId: "v-direct",
          name: "Direct Sat",
          vesselType: 6,
          situation: 3,
          bodyIndex: 1,
          crewCount: 0,
          crewCapacity: 0,
          commsControlSource: 2,
          orbit: orbit(1_200_000),
        },
        {
          vesselId: "v-relay",
          name: "Relay Sat",
          vesselType: 6,
          situation: 3,
          bodyIndex: 1,
          crewCount: 0,
          crewCapacity: 0,
          commsControlSource: 2,
          orbit: orbit(1_600_000),
        },
        {
          vesselId: "v-relayed",
          name: "Munar Transfer Stage",
          vesselType: 0,
          situation: 4,
          bodyIndex: 1,
          crewCount: 1,
          crewCapacity: 1,
          commsControlSource: 1,
          orbit: orbit(2_000_000),
        },
        {
          vesselId: "v-isolated",
          name: "Lost Probe",
          vesselType: 0,
          situation: 3,
          bodyIndex: 1,
          crewCount: 0,
          crewCapacity: 0,
          commsControlSource: 0,
          orbit: orbit(2_400_000),
        },
      ],
    });
    fixture.emit("comms.network", {
      nodes: [
        { id: "home", displayName: "KSC", kind: 0 },
        { id: "v-direct", displayName: "Direct Sat", kind: 2 },
        { id: "v-relay", displayName: "Relay Sat", kind: 1 },
        { id: "v-relayed", displayName: "Munar Transfer Stage", kind: 2 },
      ],
      edges: [
        { a: "home", b: "v-direct", active: true },
        { a: "home", b: "v-relay", active: true },
        { a: "v-relay", b: "v-relayed", active: true },
        // v-isolated deliberately has NO edge at all: unreachable from home.
      ],
    });
  });

  return { container: view.container, fixture };
}

async function waitForRendered() {
  await waitFor(() =>
    expect(screen.getAllByText("Kerbin").length).toBeGreaterThan(0),
  );
}

describe("SystemView selection: brighten, CommNet path colour, info panel", () => {
  it("shows the frame body's almanac and every orbit faint when nothing is selected", async () => {
    const { container } = mountScene();
    await waitForRendered();

    const ring = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="vessel-orbit:v-direct"] [data-ring="true"]',
      );
      expect(el).not.toBeNull();
      return el as SVGEllipseElement;
    });
    expect(ring.getAttribute("stroke")).toBe("var(--color-text-faint)");
    // The almanac's own title, so frame-body info rather than a vessel.
    expect(screen.getByText("orbiting Kerbol")).toBeInTheDocument();
  });

  it("brightens the selected vessel's own orbit ring and swaps the info panel to its meta", async () => {
    const { container } = mountScene();
    await waitForRendered();

    const marker = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="vessel-orbit:v-direct"]',
      );
      expect(el).not.toBeNull();
      return el as SVGGElement;
    });
    fireEvent.click(marker);

    await waitFor(() => {
      const ring = container.querySelector(
        '[data-entity-id="vessel-orbit:v-direct"] [data-ring="true"]',
      );
      expect(ring?.getAttribute("stroke")).toBe("var(--color-accent-fg)");
    });

    // The selected vessel's roster meta replaces the almanac.
    expect(screen.getByText("Direct Sat")).toBeInTheDocument();
    expect(screen.queryByText("orbiting Kerbol")).not.toBeInTheDocument();
  });

  it("highlights a direct one-hop CommNet path green", async () => {
    const { container } = mountScene();
    await waitForRendered();
    const marker = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="vessel-orbit:v-direct"]',
      );
      expect(el).not.toBeNull();
      return el as SVGGElement;
    });
    fireEvent.click(marker);

    const edge = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="comms-edge:home:v-direct"]',
      );
      expect(el).not.toBeNull();
      return el as SVGLineElement;
    });
    expect(edge.getAttribute("stroke")).toBe("var(--color-status-go-mark)");
  });

  it("colours a relayed two-hop CommNet path by the selected vessel's OWN control state, not the graph's all-active heuristic", async () => {
    const { container } = mountScene();
    await waitForRendered();
    const marker = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="vessel-orbit:v-relayed"]',
      );
      expect(el).not.toBeNull();
      return el as SVGGElement;
    });
    fireEvent.click(marker);

    // Both hops are active, but v-relayed's own control source is Partial, so the path draws the degraded tone the info panel's "relay" row implies, not green.
    await waitFor(() => {
      const homeToRelay = container.querySelector(
        '[data-entity-id="comms-edge:home:v-relay"]',
      );
      const relayToVessel = container.querySelector(
        '[data-entity-id="comms-edge:v-relay:v-relayed"]',
      );
      expect(homeToRelay?.getAttribute("stroke")).toBe(
        "var(--color-status-warning-bg)",
      );
      expect(relayToVessel?.getAttribute("stroke")).toBe(
        "var(--color-status-warning-bg)",
      );
    });
    expect(screen.getByText("relay")).toBeInTheDocument();

    // The UNRELATED direct edge stays faint, not swept up in the highlight.
    const unrelated = container.querySelector(
      '[data-entity-id="comms-edge:home:v-direct"]',
    );
    expect(unrelated?.getAttribute("stroke")).toBe("var(--color-text-faint)");
  });

  it("colours a direct one-hop CommNet path green for a FULL-control vessel, keyed off the same roster value", async () => {
    const { container } = mountScene();
    await waitForRendered();
    const marker = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="vessel-orbit:v-direct"]',
      );
      expect(el).not.toBeNull();
      return el as SVGGElement;
    });
    fireEvent.click(marker);

    // Full control: roster and graph agree, and the colour still derives from the roster.
    const edge = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="comms-edge:home:v-direct"]',
      );
      expect(el).not.toBeNull();
      return el as SVGLineElement;
    });
    expect(edge.getAttribute("stroke")).toBe("var(--color-status-go-mark)");
    expect(screen.getByText("connected")).toBeInTheDocument();
  });

  it("selects a vessel with no CommNet route without highlighting any edge", async () => {
    const { container } = mountScene();
    await waitForRendered();
    const marker = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="vessel-orbit:v-isolated"]',
      );
      expect(el).not.toBeNull();
      return el as SVGGElement;
    });
    fireEvent.click(marker);

    // The vessel's own ring still brightens (selection itself always works)...
    await waitFor(() => {
      const ring = container.querySelector(
        '[data-entity-id="vessel-orbit:v-isolated"] [data-ring="true"]',
      );
      expect(ring?.getAttribute("stroke")).toBe("var(--color-accent-fg)");
    });
    // ...but no comms edge on screen belongs to an unreachable vessel's empty path.
    for (const id of [
      "comms-edge:home:v-direct",
      "comms-edge:home:v-relay",
      "comms-edge:v-relay:v-relayed",
    ]) {
      const edge = container.querySelector(`[data-entity-id="${id}"]`);
      expect(edge?.getAttribute("stroke")).toBe("var(--color-text-faint)");
    }
    expect(screen.getByText("Lost Probe")).toBeInTheDocument();
  });

  it("is keyboard operable: Enter selects, Escape deselects back to the frame-body almanac", async () => {
    const { container } = mountScene();
    await waitForRendered();
    const marker = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="vessel-orbit:v-direct"]',
      );
      expect(el).not.toBeNull();
      return el as SVGGElement;
    });

    marker.focus();
    fireEvent.keyDown(marker, { key: "Enter" });
    await waitFor(() =>
      expect(screen.getByText("Direct Sat")).toBeInTheDocument(),
    );
    expect(marker).toHaveAttribute("aria-pressed", "true");

    // Escape bubbles to the document-level listener that is live only while something is selected.
    fireEvent.keyDown(marker, { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByText("orbiting Kerbol")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Direct Sat")).not.toBeInTheDocument();
  });

  it("click-again on the same vessel deselects, same as Escape", async () => {
    const { container } = mountScene();
    await waitForRendered();
    const marker = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="vessel-orbit:v-direct"]',
      );
      expect(el).not.toBeNull();
      return el as SVGGElement;
    });
    fireEvent.click(marker);
    await waitFor(() =>
      expect(screen.getByText("Direct Sat")).toBeInTheDocument(),
    );
    fireEvent.click(marker);
    await waitFor(() =>
      expect(screen.getByText("orbiting Kerbol")).toBeInTheDocument(),
    );
  });

  it("has no axe violations with a selection active", async () => {
    const { container } = mountScene();
    await waitForRendered();
    const marker = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="vessel-orbit:v-relayed"]',
      );
      expect(el).not.toBeNull();
      return el as SVGGElement;
    });
    fireEvent.click(marker);
    await waitFor(() =>
      expect(screen.getByText("Munar Transfer Stage")).toBeInTheDocument(),
    );

    await expectNoA11yViolations(container);
  });
});
