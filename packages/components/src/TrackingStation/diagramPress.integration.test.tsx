import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { TrackingStationComponent } from "./index";
import "./vesselOrbitsContribution";

/** What an operator can press on the diagram itself: the bodies, to pin their almanac, and the active craft, to read its own roster fields. */

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;

const META = {
  componentId: "tracking-station",
  contributionSlots: ["tracking-station.entities"] as const,
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

/** Holds the frame clock for one test, so the eased zoom Focus vessel starts never ticks outside `act`. */
function holdFrames() {
  const spy = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation(() => 0);
  onTestFinished(() => spy.mockRestore());
}

function mountScene({
  catalogListsCraft = true,
  recordPlacedAt,
  frame = "Kerbin",
}: {
  catalogListsCraft?: boolean;
  recordPlacedAt?: number;
  frame?: string;
} = {}) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider value={META}>
        <ContributionsProvider>
          <TrackingStationComponent
            config={{ frame } as never}
            id="sv-press"
            w={10}
            h={14}
          />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("trackingStation.bodies", {
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
        {
          index: 3,
          name: "Duna",
          parentIndex: 0,
          radius: 320_000,
          gravParameter: 3.0136321e11,
          sphereOfInfluence: 47_921_949,
          orbit: { ...orbit(20_726_155_264), meanAnomalyAtEpoch: 1 },
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
    fixture.emit("trackingStation.catalog", {
      entries: catalogListsCraft
        ? [
            {
              vesselId: "v-active",
              name: "Active Craft",
              vesselType: 0,
              situation: 3,
              bodyIndex: 1,
              crewCount: 2,
              crewCapacity: 3,
              commsControlSource: 2,
              orbit: orbit(
                recordPlacedAt === undefined ? 3_000_000 : 5_000_000,
              ),
              ...(recordPlacedAt === undefined
                ? {}
                : { placeAsOfUt: recordPlacedAt }),
            },
          ]
        : [],
    });
  });
  return { fixture, ...view };
}

describe("TrackingStation: pressing the diagram", () => {
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

  /** A centre whose catalog has not listed the flown craft yet still lets the operator select it, from the craft's own reports. */
  it("selects the active vessel from its own marker before the catalog lists it", async () => {
    mountScene({ catalogListsCraft: false });
    const hit = await screen.findByRole("button", { name: "Active vessel" });
    expect(hit).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(hit);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Active vessel" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByText("Active Craft")).toBeInTheDocument();
  });

  it("places the flown craft by its own report while the record is no newer", async () => {
    const { container } = mountScene();
    await screen.findByRole("button", { name: "Active vessel" });

    expect(
      container.querySelector('[data-vessel-placed-by="report"]'),
    ).not.toBeNull();
  });

  /** A centre that has seen the craft since it last heard from it draws the craft where the record has it. */
  it("places the flown craft by the record when the record is newer than its report", async () => {
    const { container } = mountScene({ recordPlacedAt: 500 });
    await screen.findByRole("button", { name: "Active vessel" });

    await waitFor(() =>
      expect(
        container.querySelector('[data-vessel-placed-by="record"]'),
      ).not.toBeNull(),
    );
  });

  it("pins a pressed body's almanac in the aside, and holds the view on it when it is pressed again", async () => {
    // Anchoring eases the view; the ease is left unticked so it never lands outside `act`.
    const spy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 0);
    onTestFinished(() => spy.mockRestore());
    mountScene();
    fireEvent.click(await screen.findByRole("button", { name: "Mun" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mun" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(screen.getByText("orbiting Kerbin")).toBeInTheDocument();
    expect(screen.queryByText(/anchored/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Mun" }));
    await waitFor(() =>
      expect(screen.getByText(/Frame: Mun \(anchored\)/)).toBeInTheDocument(),
    );
  });

  /** The frame's own body sits at the centre; pressing it shows its almanac, and the view stays where it was. */
  it("pins the frame body's almanac when it is pressed, and leaves the view where it is", async () => {
    const { container } = mountScene();
    const home = await screen.findByRole("button", { name: "Kerbin" });
    const before = container
      .querySelector("svg[viewBox]")
      ?.getAttribute("viewBox");
    expect(home).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(home);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Kerbin" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(
      container.querySelector("svg[viewBox]")?.getAttribute("viewBox"),
    ).toBe(before);
  });

  /** Once another body is pinned, the frame body can be pressed back into the aside. */
  it("lets the frame body be pressed again after another body was pinned", async () => {
    mountScene();
    fireEvent.click(await screen.findByRole("button", { name: "Mun" }));
    await waitFor(() =>
      expect(screen.getByText("orbiting Kerbin")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Kerbin" }));

    await waitFor(() =>
      expect(screen.getByText("orbiting Kerbol")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Mun" })).toHaveAttribute(
      "aria-pressed",
      "false",
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
    holdFrames();
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
    holdFrames();
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

  /** Around the star the home body is a child like any other, and the craft orbiting it is drawn on top of it. */
  describe("with the star as the frame", () => {
    it("shows the home body's almanac when it is pressed after another body", async () => {
      mountScene({ frame: "Kerbol" });
      fireEvent.click(await screen.findByRole("button", { name: "Duna" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Duna" })).toHaveAttribute(
          "aria-pressed",
          "true",
        ),
      );

      fireEvent.click(screen.getByRole("button", { name: "Kerbin" }));

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Kerbin" })).toHaveAttribute(
          "aria-pressed",
          "true",
        ),
      );
      expect(screen.getByRole("button", { name: "Duna" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByText("Radius")).toBeInTheDocument();
    });

    it("selects the active vessel after another body was pressed", async () => {
      mountScene({ frame: "Kerbol" });
      fireEvent.click(await screen.findByRole("button", { name: "Duna" }));
      fireEvent.click(screen.getByRole("button", { name: "Active vessel" }));

      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Active vessel" }),
        ).toHaveAttribute("aria-pressed", "true"),
      );
      expect(screen.getByRole("button", { name: "Duna" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    /** Where the craft sits on its body, the later-drawn target takes the press: the body has to be it, and the craft's target has to reach past the body's dot. */
    it("draws the craft's press target under the body it orbits and wider than its dot", async () => {
      const { container } = mountScene({ frame: "Kerbol" });
      const craft = await screen.findByRole("button", {
        name: "Active vessel",
      });
      const body = screen.getByRole("button", { name: "Kerbin" });
      expect(
        craft.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const dot = container.querySelector('circle[data-body="Kerbin"]');
      const hit = craft.querySelector("circle:not(.focus-ring)");
      expect(Number(hit?.getAttribute("r"))).toBeGreaterThan(
        Number(dot?.getAttribute("r")),
      );
    });
  });
});
