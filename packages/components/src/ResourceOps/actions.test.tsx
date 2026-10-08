import {
  ContributionsProvider,
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ResourceOpsComponent } from "./index";

const INSTANCE = "resource-ops-actions";

const DRILLS = [
  { partId: "101", partTitle: "Drill-O-Matic", resource: "Ore", running: true },
  {
    partId: "102",
    partTitle: "Drill-O-Matic Junior",
    resource: "Ore",
    running: false,
  },
];

const CONVERTERS = [
  {
    partId: "201",
    partTitle: "Convert-O-Tron 250",
    running: true,
    inputs: [{ resource: "Ore", rate: 0.5 }],
    outputs: [{ resource: "LiquidFuel", rate: 0.45 }],
  },
];

function renderWidget() {
  const fixture = setupStreamFixture({ suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: INSTANCE }}>
        <WidgetMetaContext.Provider
          value={{ componentId: "resource-ops", contributionSlots: [] }}
        >
          <ContributionsProvider>
            <ResourceOpsComponent id={INSTANCE} w={6} h={8} />
          </ContributionsProvider>
        </WidgetMetaContext.Provider>
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return fixture;
}

const next = (value = true) =>
  dispatchAction(INSTANCE, "next", { kind: "button", value });

/** The unit the widget currently marks as `aria-current`. */
function highlightedUnit(): string | null {
  const marked = document.querySelector('[aria-current="true"]');
  return marked?.textContent ?? null;
}

describe("ResourceOps actions", () => {
  afterEach(() => {
    clearActionHandlers();
  });

  it("next walks the drills then the converters, and wraps to the first", async () => {
    const fixture = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", CONVERTERS);
    });
    await screen.findByText("Convert-O-Tron 250");
    expect(highlightedUnit()).toContain("Drill-O-Matic");
    expect(highlightedUnit()).not.toContain("Junior");

    const reported: unknown[] = [];
    for (let press = 0; press < 3; press++) {
      act(() => {
        reported.push(next());
      });
    }

    expect(reported).toEqual([
      { unit: "Drill-O-Matic Junior" },
      { unit: "Convert-O-Tron 250" },
      { unit: "Drill-O-Matic" },
    ]);
    expect(highlightedUnit()).toContain("Drill-O-Matic");
    expect(highlightedUnit()).not.toContain("Junior");
  });

  it("next moves the highlight onto the unit it reports", async () => {
    const fixture = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", CONVERTERS);
    });
    await screen.findByText("Convert-O-Tron 250");

    act(() => {
      next();
    });

    expect(highlightedUnit()).toContain("Drill-O-Matic Junior");
  });

  it("next ignores the release of the button", async () => {
    const fixture = renderWidget();
    act(() => {
      fixture.emit("isru.drills", DRILLS);
      fixture.emit("isru.converters", CONVERTERS);
    });
    await screen.findByText("Convert-O-Tron 250");

    let result: unknown = "unset";
    act(() => {
      result = next(false);
    });

    expect(result).toBeUndefined();
    expect(highlightedUnit()).not.toContain("Junior");
  });

  it("next does nothing on a vessel with no drills or converters", async () => {
    const fixture = renderWidget();
    act(() => {
      fixture.emit("isru.drills", []);
      fixture.emit("isru.converters", []);
    });

    let result: unknown = "unset";
    act(() => {
      result = next();
    });

    expect(result).toBeUndefined();
    expect(highlightedUnit()).toBeNull();
  });
});
