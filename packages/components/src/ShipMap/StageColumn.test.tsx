import type { PartStateModule, VesselTopology } from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { topologyToVesselPartsWire } from "../test/topologyToVesselPartsWire";
import fuellinePrelaunch from "./__fixtures__/fuelline-tester-22parts-prelaunch.json";
import { ShipMapComponent } from "./index";
import { StageColumn } from "./StageColumn";
import { buildStageStack } from "./stageStack";

const TOPOLOGY = fuellinePrelaunch["v.topology"] as VesselTopology;
const WIRE = topologyToVesselPartsWire(TOPOLOGY, new Map());
void ({} as PartStateModule);

const STAGES = buildStageStack(
  [
    { stage: 2, title: "Reliant Engine", name: "r" },
    { stage: 2, title: "Sepratron I", name: "s" },
    { stage: 2, title: "Sepratron I", name: "s" },
    { stage: 1, title: "Terrier", name: "t" },
  ],
  2,
);

describe("StageColumn", () => {
  it("lists each stage with its parts and counts as real lists", async () => {
    const { container } = render(<StageColumn stages={STAGES} />);
    const rows = within(screen.getByRole("region", { name: "Staging" }))
      .getAllByRole("listitem")
      .filter((li) => li.textContent?.startsWith("Stage"));
    expect(rows.map((r) => r.textContent?.match(/^Stage \d/)?.[0])).toEqual([
      "Stage 2",
      "Stage 1",
    ]);
    expect(rows[0].textContent).toMatch(/Sepratron I\s*×2/);
    await expectNoA11yViolations(container);
  });

  it("marks the current stage in words and with aria-current", () => {
    render(<StageColumn stages={STAGES} />);
    const current = document.querySelector('[aria-current="step"]');
    expect(current?.textContent).toMatch(/Stage 2/);
    expect(current?.textContent).toMatch(/Next/);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });
});

describe("ShipMap stage column", () => {
  function mount() {
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    render(
      <fixture.Provider>
        <ShipMapComponent id="ship-map-stages" w={8} h={10} />
      </fixture.Provider>,
    );
    return fixture;
  }

  async function emitCraft(
    fixture: ReturnType<typeof setupStreamFixture>,
    currentStage: number,
  ) {
    act(() => {
      fixture.emit("vessel.parts", WIRE);
      fixture.emit("vessel.structure", { currentStage });
    });
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Staging" })).toBeTruthy(),
    );
  }

  it("marks the stage vessel.structure names and drops the stages already fired", async () => {
    const fixture = mount();
    const stages = [
      ...new Set(
        buildStageStack(
          TOPOLOGY.parts.map((p) => ({
            stage: p.inverseStage ?? null,
            title: p.title ?? p.name,
            name: p.name,
          })),
        ).map((s) => s.stage),
      ),
    ];
    const current = stages[Math.min(1, stages.length - 1)];
    await emitCraft(fixture, current);

    const marked = document.querySelector('[aria-current="step"]');
    expect(marked?.textContent).toMatch(new RegExp(`Stage ${current}(?!\\d)`));
    const listed = within(screen.getByRole("region", { name: "Staging" }))
      .getAllByText(/^Stage \d+$/)
      .map((n) => Number(n.textContent?.replace("Stage ", "")));
    expect(Math.max(...listed)).toBe(current);
  });

  it("leaves every stage unmarked once the stage reading is held", async () => {
    const fixture = mount();
    await emitCraft(fixture, 0);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });

    await waitFor(() =>
      expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(
        0,
      ),
    );
    expect(screen.getByLabelText("Ship diagram")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Staging" })).toBeTruthy();
  });
});
