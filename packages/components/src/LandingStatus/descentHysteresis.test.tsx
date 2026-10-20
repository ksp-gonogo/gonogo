import {
  DashboardItemContext,
  PerfBudget,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { act, render } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { expect, it } from "vitest";
import { startRigReplay, wireFixture } from "../test/replayRig";
import {
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import { LandingStatusComponent } from "./index";

interface Step {
  urgency: string | null;
  regime: string | null;
}

/** What the widget reads at each sample of the sea descent under full chutes, a touchdown speed that sits on the 6 m/s edge. */
async function playChuteDescent(): Promise<Step[]> {
  const restore = installSizedResizeObserver({ w: 720, h: 640 });
  registerStockBodies();
  const replay = startRigReplay(wireFixture("landing-sea-chute"));
  const { container, unmount } = render(
    <replay.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "rig" }}>
        <WidgetContributions Widget={LandingStatusComponent}>
          <LandingStatusComponent id="rig" w={14} h={24} />
        </WidgetContributions>
      </DashboardItemContext.Provider>
    </replay.Provider>,
  );
  const steps: Step[] = [];
  for (let s = 0; s <= Math.ceil(replay.duration); s += 0.25) {
    for (const b of PerfBudget.getAll()) b.reset();
    await act(async () => {
      replay.advanceTo(s);
      await new Promise((r) => setTimeout(r, 60));
    });
    const text = visibleText(container);
    steps.push({
      urgency:
        container
          .querySelector('[data-plot-layer="urgency"]')
          ?.textContent?.trim() ?? null,
      regime:
        /Regime(accelerating|at-terminal|decelerating)/.exec(text)?.[1] ?? null,
    });
  }
  unmount();
  restore();
  return steps;
}

function changes(values: (string | null)[]): number {
  const seen = values.filter((v) => v !== null);
  return seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length;
}

it("holds the urgency tier and the regime steady while the touchdown speed jitters on a band edge", async () => {
  const steps = await playChuteDescent();
  expect(changes(steps.map((s) => s.urgency))).toBeLessThanOrEqual(1);
  expect(changes(steps.map((s) => s.regime))).toBeLessThanOrEqual(2);
}, 300_000);
