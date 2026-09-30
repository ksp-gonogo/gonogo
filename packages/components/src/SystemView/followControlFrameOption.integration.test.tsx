import { ContributionsProvider, WidgetMetaContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
// The host's own `system-view.projection` entries: in production these are registered by `index.tsx`'s own module load, which always precedes a config form mounting inside its widget's modal.
import "./projectionContribution";
import { SystemViewConfigForm } from "./SystemViewConfigForm";

/**
 * The config form's "Draw the picture in" field, once it runs through the
 * shared `ReadFrameControl`: "Follow the in-game view" is on offer only once
 * the live Control Frame would actually draw something new, per the operator
 * ruling. A stock-shaped stream (fixed, body-centred-inertial about the frame
 * body) never earns the option; a stream that elects a differing frame does.
 */

const KERBOL_MU = 1.1723328e18;
const KERBIN_MU = 3.5316e12;
const MUN_MU = 6.5138398e10;
const KERBOL_INDEX = 0;
const KERBIN_INDEX = 1;
const MUN_INDEX = 2;

const WIDGET_META = {
  componentId: "system-view",
  contributionSlots: ["system-view.projection"] as const,
};

function kerbolSystem() {
  return {
    bodies: [
      {
        index: KERBOL_INDEX,
        name: "Kerbol",
        parentIndex: null,
        radius: 261_600_000,
        gravParameter: KERBOL_MU,
        orbit: null,
      },
      {
        index: KERBIN_INDEX,
        name: "Kerbin",
        parentIndex: KERBOL_INDEX,
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
          meanAnomalyAtEpoch: 1,
          epoch: 0,
        },
      },
      {
        index: MUN_INDEX,
        name: "Mun",
        parentIndex: KERBIN_INDEX,
        radius: 200_000,
        gravParameter: MUN_MU,
        sphereOfInfluence: 2_429_559,
        orbit: {
          sma: 12_000_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 1.7,
          epoch: 0,
        },
      },
    ],
  };
}

function mount() {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider value={WIDGET_META}>
        <ContributionsProvider>
          <SystemViewConfigForm config={{ frame: "Kerbin" }} onSave={vi.fn()} />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", kerbolSystem());
  });
  return { fixture, view };
}

function projectionSelect() {
  return screen.getByRole("combobox", { name: "Draw the picture in" });
}

describe("SystemViewConfigForm: the follow-control-frame option", () => {
  it("is not offered on a stock-shaped Control Frame (it would draw the same as the default entry)", async () => {
    const { fixture } = mount();
    act(() => {
      fixture.emit("system.frame", { kind: 1, centreBody: "Kerbin" });
    });
    await waitFor(() => {
      expect(projectionSelect()).toBeTruthy();
    });
    expect(
      screen.queryByText("Follow the in-game view"),
    ).not.toBeInTheDocument();
  });

  it("appears once the Control Frame elects a frame the picker does not already offer", async () => {
    const { fixture, view } = mount();
    act(() => {
      fixture.emit("system.frame", {
        kind: 4,
        primaryBody: "Kerbin",
        secondaryBody: "Mun",
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Follow the in-game view")).toBeTruthy();
    });
    await expectNoA11yViolations(view.container);
  });
});
