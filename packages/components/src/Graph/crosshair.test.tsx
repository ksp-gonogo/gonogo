import { act, fireEvent, render, waitFor } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  installFixedSizeResizeObserver,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GraphComponent } from "./index";

let restoreResizeObserver: () => void = () => {};

describe("Graph crosshair", () => {
  beforeEach(() => {
    restoreResizeObserver = installFixedSizeResizeObserver({
      width: 400,
      height: 300,
    });
  });
  afterEach(() => restoreResizeObserver());

  it("reads each series at the sample the keyboard lands on, with its unit", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    const config = {
      series: [
        {
          id: "alt",
          key: "vessel.flight.altitudeTerrain",
          axis: "auto" as const,
        },
      ],
      variant: "chart" as const,
      windowSec: 300,
    };
    const { container } = render(
      <fixture.Provider>
        <GraphComponent config={config} id="graph-crosshair" w={10} h={8} />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit(
        "vessel.flight",
        { altitudeTerrain: 8_000 },
        { validAt: -100 },
      );
      fixture.emit(
        "vessel.flight",
        { altitudeTerrain: 12_345 },
        { validAt: 10 },
      );
    });
    await waitFor(() =>
      expect(container.querySelector("svg[tabindex]")).not.toBeNull(),
    );
    const svg = container.querySelector("svg[tabindex]") as SVGSVGElement;
    const status = container.querySelector('[role="status"]') as HTMLElement;

    act(() => svg.focus());
    expect(status.textContent).toMatch(/12[.,]?345|12\.3/);
    expect(status.textContent).toMatch(/m|km/);

    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(status.textContent).toMatch(/8[.,]?000|8\.0/);
    expect(status.textContent).not.toMatch(/no sample/);
    await expectNoA11yViolations(container);
  });
});
