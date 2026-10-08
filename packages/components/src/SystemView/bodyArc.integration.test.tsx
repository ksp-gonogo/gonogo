import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import {
  PropagationHorizonKindLike,
  TrajectoryKindLike,
} from "@ksp-gonogo/sitrep-client";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SystemViewComponent } from "./index";

const KERBOL_INDEX = 0;
const KERBIN_INDEX = 1;
const MUN_INDEX = 2;

const MUN_ELEMENTS = {
  sma: 12_000_000,
  ecc: 0.2,
  inc: 30,
  lan: 20,
  argPe: 40,
  meanAnomalyAtEpoch: 1.7,
  epoch: 0,
};

function system(munHorizon?: Record<string, unknown>) {
  return {
    bodies: [
      {
        index: KERBOL_INDEX,
        name: "Kerbol",
        parentIndex: null,
        radius: 261_600_000,
        gravParameter: 1.1723328e18,
        orbit: null,
      },
      {
        index: KERBIN_INDEX,
        name: "Kerbin",
        parentIndex: KERBOL_INDEX,
        radius: 600_000,
        gravParameter: 3.5316e12,
        sphereOfInfluence: 84_159_286,
        isHome: true,
        orbit: {
          sma: 13_599_840_256,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 1,
          epoch: 0,
        },
      },
      {
        index: MUN_INDEX,
        name: "Mun",
        parentIndex: KERBIN_INDEX,
        radius: 200_000,
        gravParameter: 6.5138398e10,
        sphereOfInfluence: 2_429_559,
        orbit: MUN_ELEMENTS,
        ...(munHorizon === undefined ? {} : { horizon: munHorizon }),
      },
    ],
  };
}

const WIDGET_META = {
  componentId: "system-view",
  contributionSlots: ["system-view.projection"] as const,
};

async function mount(munHorizon?: Record<string, unknown>) {
  const fixture = setupStreamFixture({ pinnedUt: 100, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider value={WIDGET_META}>
        <ContributionsProvider>
          <SystemViewComponent config={{ frame: "Kerbin" } as never} id="sv" />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", system(munHorizon));
    fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
  });
  await waitFor(() => {
    expect(
      view.container.querySelector('circle[data-body="Mun"]'),
    ).not.toBeNull();
  });
  await act(async () => {});
  return view;
}

describe("SystemView body paths follow the body's own provider", () => {
  it("draws a body on a fixed orbit as a closed ring with no stop mark", async () => {
    const { container } = await mount();
    const ring = container.querySelector('path[data-body-orbit="Mun"]');
    expect(ring?.getAttribute("d")).toMatch(/Z$/);
    expect(container.querySelector("[data-trajectory-mark]")).toBeNull();
    await expectNoA11yViolations(container);
  });

  it("draws an integrated body as an open arc stopped at its horizon, with a mark where it stops", async () => {
    const { container } = await mount({
      kind: PropagationHorizonKindLike.Until,
      trajectoryKind: TrajectoryKindLike.Integrated,
      untilUt: 100 + 20_000,
    });
    const arc = container.querySelector('path[data-body-orbit="Mun"]');
    expect(arc).not.toBeNull();
    expect(arc?.getAttribute("d")).not.toMatch(/Z/);
    const mark = container.querySelector(
      'line[data-trajectory-mark="horizon"][data-body-orbit-end="Mun"]',
    );
    expect(mark).not.toBeNull();
    await expectNoA11yViolations(container);
  });

  it("draws no path for a body whose horizon is behind the instant on screen", async () => {
    const { container } = await mount({
      kind: PropagationHorizonKindLike.Until,
      trajectoryKind: TrajectoryKindLike.Integrated,
      untilUt: 50,
    });
    expect(container.querySelector('path[data-body-orbit="Mun"]')).toBeNull();
    expect(container.querySelector("[data-trajectory-mark]")).toBeNull();
  });
});
