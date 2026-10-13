import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GraphView } from "./GraphView";

const CURVE = { id: "c", label: "Curve", xs: [0, 1, 2], ys: [1, 2, 3] };
const REFERENCE_PLOT = {
  series: [],
  windowSec: 60,
  x: { topic: "vessel.flight", field: "altitudeAsl" },
};

/** The same figures go to the side column or to a corner card, chosen from the frame's measured size and never from the grid size. */
describe("GraphView aside and overlay placement", () => {
  let restore: () => void = () => {};
  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  function renderAt(size: { width: number; height: number }) {
    restore = installFixedSizeResizeObserver(size);
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    render(
      <fixture.Provider>
        <GraphView
          config={REFERENCE_PLOT}
          referenceCurves={[CURVE]}
          plotAside={<span>aside card</span>}
          plotOverlay={<span>overlay card</span>}
          plotOverlayCorner="bottom-left"
        />
      </fixture.Provider>,
    );
  }

  it("draws the side column in a wide frame, and not the corner card as well", async () => {
    renderAt({ width: 700, height: 300 });
    await waitFor(() =>
      expect(screen.getByText("aside card")).toBeInTheDocument(),
    );
    expect(screen.queryByText("overlay card")).toBeNull();
  });

  it("draws the corner card in a frame too narrow for the column", async () => {
    renderAt({ width: 400, height: 300 });
    await waitFor(() =>
      expect(screen.getByText("overlay card")).toBeInTheDocument(),
    );
    expect(screen.queryByText("aside card")).toBeNull();
  });

  it("draws the corner card in a tall narrow frame that is wide enough for it", async () => {
    renderAt({ width: 340, height: 700 });
    await waitFor(() =>
      expect(screen.getByText("overlay card")).toBeInTheDocument(),
    );
    expect(screen.queryByText("aside card")).toBeNull();
  });

  it("draws neither where neither fits", async () => {
    renderAt({ width: 260, height: 700 });
    await waitFor(() => expect(screen.getByRole("img")).toBeInTheDocument());
    expect(screen.queryByText("aside card")).toBeNull();
    expect(screen.queryByText("overlay card")).toBeNull();
  });
});
