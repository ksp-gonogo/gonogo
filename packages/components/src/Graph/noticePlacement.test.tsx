import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GraphView } from "./GraphView";

const CURVE = { id: "c", label: "Curve", xs: [0, 1, 2], ys: [1, 2, 3] };
const REFERENCE_PLOT = {
  series: [],
  windowSec: 60,
  xKey: "vessel.flight.altitudeAsl",
};

/** The kit, not the widget, decides where a chart's notice sits: from the measured space and from whether the plot has anything to cover. */
describe("GraphView notice placement", () => {
  let restore: () => void = () => {};
  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  function renderAt(
    size: { width: number; height: number },
    withCurve: boolean,
  ) {
    restore = installFixedSizeResizeObserver(size);
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    render(
      <fixture.Provider>
        <GraphView
          config={withCurve ? REFERENCE_PLOT : undefined}
          referenceCurves={withCurve ? [CURVE] : undefined}
          notice="Unknown body: plotting trace only."
        />
      </fixture.Provider>,
    );
  }

  it("centres the notice over an empty plot that has room", async () => {
    renderAt({ width: 400, height: 300 }, false);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveStyle({ position: "absolute" }),
    );
  });

  it("puts the notice below a plot that draws a curve", async () => {
    renderAt({ width: 400, height: 300 }, true);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveStyle({
        alignSelf: "flex-start",
        maxWidth: "100%",
      }),
    );
    expect(screen.getByRole("status")).not.toHaveStyle({
      position: "absolute",
    });
  });

  it("puts the notice beside a wide, short plot", async () => {
    renderAt({ width: 900, height: 200 }, true);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveStyle({ maxWidth: "40%" }),
    );
  });
});
