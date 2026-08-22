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
// Side-effect import: registers the real `system-view-vessel-orbits`
// contribution (fleet + comms.network graph), same as `index.tsx` does for
// the live app; the selection tests exercise the whole pipeline end to end,
// not `resolveSystemEntities`/`deriveCommsPath` in isolation.
import "./vesselOrbitsContribution";

/**
 * The interactive payoff: selecting a vessel display object
 * brightens its orbit, highlights its derived CommNet path to home coloured
 * by control quality, and swaps the info panel to its roster meta.
 * End-to-end against a real `SystemViewComponent`, a real stream, and the
 * real DOM `SystemEntitiesLayer` renders, mirroring
 * `commsNetworkContribution.integration.test.tsx`'s own style.
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

/** Mounts SystemViewComponent framed on Kerbin, with the active vessel
 *  ("v-active", excluded from the entities layer) plus three OTHER roster
 *  vessels exercising the three CommNet path outcomes: a direct one-hop link
 *  (v-direct), a relayed two-hop link through v-relay (v-relayed), and a
 *  vessel with no route to home at all (v-isolated). */
function mountScene() {
  const fixture: StreamFixture = setupStreamFixture({
    carriedChannels: [
      "vessel.orbit",
      "vessel.identity",
      "system.bodies",
      "system.vessels",
      "comms.network",
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
    // Frame-body info, not a vessel: the almanac's own title text.
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

    // Info panel swap: the selected vessel's roster meta, not the almanac.
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
    expect(edge.getAttribute("stroke")).toBe("var(--color-status-go-bg)");
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

    // Both hops are `active: true` (an all-active BFS route exists), but
    // v-relayed's OWN roster commsControlSource is Partial (1), which the
    // info panel reports as "relay". Colouring by the graph heuristic alone
    // would draw this GREEN, contradicting that "relay" row; it must draw
    // the same degraded tone `COMMS_PATH_COLOUR.partial` uses.
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

    // v-direct's roster commsControlSource is Full (2), "connected" in the
    // info panel: the one case where the graph heuristic and the roster
    // value happen to agree, confirming the fix didn't just invert the
    // colour, it derives it from the roster either way.
    const edge = await waitFor(() => {
      const el = container.querySelector(
        '[data-entity-id="comms-edge:home:v-direct"]',
      );
      expect(el).not.toBeNull();
      return el as SVGLineElement;
    });
    expect(edge.getAttribute("stroke")).toBe("var(--color-status-go-bg)");
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
    // ...but every comms edge on screen stays untouched: none of them belong
    // to an unreachable vessel's (empty) derived path.
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

    // Escape bubbles from the focused marker up through the DOM to
    // `document`, where `index.tsx` registers a `keydown` listener (a
    // `useEffect`, live only while something is selected) rather than
    // putting the handler on the diagram wrapper itself, same idiom
    // `ActionMenu.tsx` already uses for its own outside-pointer dismiss.
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
