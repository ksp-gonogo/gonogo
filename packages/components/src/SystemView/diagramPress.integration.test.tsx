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
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";
import "./vesselOrbitsContribution";

/** What an operator can press on the diagram itself: the bodies, to pin their almanac, and the active craft, to read its own roster fields. */

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;

const META = {
  componentId: "system-view",
  contributionSlots: ["system-view.entities"] as const,
};

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

function mountScene() {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider value={META}>
        <ContributionsProvider>
          <SystemViewComponent
            config={{ frame: "Kerbin" } as never}
            id="sv-press"
            w={10}
            h={14}
          />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", {
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
          orbit: { ...orbit(13_599_840_256), meanAnomalyAtEpoch: 3.14 },
        },
        {
          index: 2,
          name: "Mun",
          parentIndex: 1,
          radius: 200_000,
          gravParameter: 6.5138398e10,
          sphereOfInfluence: 2_429_559,
          orbit: { ...orbit(12_000_000), meanAnomalyAtEpoch: 1.7 },
        },
      ],
    });
    fixture.emit("vessel.identity", {
      vesselId: "v-active",
      name: "Active Craft",
      vesselType: 0,
      situation: 3,
      parentBodyIndex: 1,
    });
    fixture.emit("vessel.orbit", {
      referenceBodyIndex: 1,
      ...orbit(3_000_000),
      ecc: 0.1,
      inc: 40,
      argPe: 90,
      mu: KERBIN_MU,
      horizon: { kind: 1, trajectoryKind: 1 },
    });
    fixture.emit("system.vessels", {
      vessels: [
        {
          vesselId: "v-active",
          name: "Active Craft",
          vesselType: 0,
          situation: 3,
          bodyIndex: 1,
          crewCount: 2,
          crewCapacity: 3,
          commsControlSource: 2,
          orbit: orbit(3_000_000),
        },
      ],
    });
  });
  return { fixture, ...view };
}

describe("SystemView: pressing the diagram", () => {
  it("selects the active vessel from its own marker and shows its roster in the aside", async () => {
    mountScene();
    const hit = await screen.findByRole("button", { name: "Active vessel" });
    expect(hit).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(hit);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Active vessel" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByText("Active Craft")).toBeInTheDocument();
    expect(screen.queryByText("orbiting Kerbol")).not.toBeInTheDocument();
  });

  it("pins a pressed body's almanac in the aside until it is pressed again", async () => {
    mountScene();
    fireEvent.click(await screen.findByRole("button", { name: "Mun" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mun" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByText("orbiting Kerbin")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mun" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mun" })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
  });

  it("draws a pinned body's keyboard focus ring outside its pinned ring", async () => {
    const { container } = mountScene();
    fireEvent.click(await screen.findByRole("button", { name: "Mun" }));
    const pinnedRing = await waitFor(() => {
      const ring = container.querySelector('[data-body-pinned="Mun"]');
      expect(ring).not.toBeNull();
      return ring as Element;
    });
    const focusRing = screen
      .getByRole("button", { name: "Mun" })
      .querySelector("circle.focus-ring");
    expect(focusRing).not.toBeNull();
    expect(Number(focusRing?.getAttribute("r"))).toBeGreaterThan(
      Number(pinnedRing.getAttribute("r")),
    );
  });

  it("offers a focus-on-vessel control that centres the view on the craft", async () => {
    const { container } = mountScene();
    const before = (
      await waitFor(() => {
        const svg = container.querySelector("svg[viewBox]");
        expect(svg).not.toBeNull();
        return svg;
      })
    )?.getAttribute("viewBox");
    fireEvent.click(
      await screen.findByRole("button", { name: "Focus vessel" }),
    );
    await waitFor(() =>
      expect(
        container.querySelector("svg[viewBox]")?.getAttribute("viewBox"),
      ).not.toBe(before),
    );
    expect(
      screen.getByRole("button", { name: "Reset view" }),
    ).toBeInTheDocument();
  });

  it("keeps following the craft until the view is reset", async () => {
    mountScene();
    const focus = await screen.findByRole("button", { name: "Focus vessel" });
    expect(focus).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(focus);
    expect(focus).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(await screen.findByRole("button", { name: "Reset view" }));
    expect(focus).toHaveAttribute("aria-pressed", "false");
  });

  it("has no axe violations with the pressable marks", async () => {
    const { container } = mountScene();
    await screen.findByRole("button", { name: "Active vessel" });
    await expectNoA11yViolations(container);
  });
});
