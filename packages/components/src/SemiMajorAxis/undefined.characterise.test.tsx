import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SemiMajorAxisComponent } from "./index";

/**
 * What `undefined` means at this widget's two telemetry reads.
 *
 * - `sma === undefined || !Number.isFinite(sma.magnitude)` is the whole-widget
 *   gate: one "No orbit data" state for nothing arrived, a record without sma,
 *   a tombstone, and a non-finite number
 * - the subtitle's body suffix is bare while the body table has not arrived,
 *   and the null glyph once `system.bodies` is a confirmed tombstone
 */

const SEMI_MAJOR_AXIS_CHANNELS = ["vessel.orbit", "system.bodies"];

function renderSma(fixture: ReturnType<typeof setupStreamFixture>) {
  // Clears both the subtitle and sparkline size thresholds, so anything missing is a data gate.
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "sma-characterise" }}>
        <SemiMajorAxisComponent config={{}} id="sma-characterise" w={5} h={6} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

function makeFixture() {
  return setupStreamFixture({
    carriedChannels: SEMI_MAJOR_AXIS_CHANNELS,
    pinnedUt: 10,
    suspendFrames: true,
  });
}

describe("SemiMajorAxis: what undefined means today", () => {
  it("renders the empty state and NONE of the readout furniture before anything arrives", async () => {
    // Nothing arrived: the whole body subtree is behind the gate, so readout, sparkline and caption vanish together.
    const fixture = makeFixture();
    const { container } = renderSma(fixture);

    expect(await screen.findByText("No orbit data")).toBeInTheDocument();
    // No readout element at all, so a screen reader is told nothing rather than "unknown".
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.querySelector("svg[aria-label='SMA trend']")).toBeNull();
    expect(screen.queryByText(/Semi-major axis/)).not.toBeInTheDocument();
    // The panel frame survives: the operator sees a titled tile.
    expect(screen.getByText("SMA")).toBeInTheDocument();
  });

  it("falls back to the empty state when a later orbit record arrives without an sma field", async () => {
    // A live reading first, so the field-less frame is provably delivered; it renders like a cold topic.
    const fixture = makeFixture();
    renderSma(fixture);

    act(() => {
      fixture.emit("vessel.orbit", { sma: 675_000, referenceBodyIndex: 1 });
    });
    await waitFor(() => expect(visibleText()).toContain("675.0 km"));

    act(() => {
      fixture.emit("vessel.orbit", { referenceBodyIndex: 1 }, { validAt: 5 });
    });

    await waitFor(() =>
      expect(screen.getByText("No orbit data")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("falls back to the empty state for a confirmed tombstone on vessel.orbit", async () => {
    // A tombstone optional-chains into the same undefined as a cold start, so the readout vanishes back to the loading message.
    const fixture = makeFixture();
    renderSma(fixture);

    act(() => {
      fixture.emit("vessel.orbit", { sma: 675_000, referenceBodyIndex: 1 });
    });
    await waitFor(() => expect(visibleText()).toContain("675.0 km"));

    act(() => {
      fixture.emit("vessel.orbit", null, { validAt: 5 });
    });

    await waitFor(() =>
      expect(screen.getByText("No orbit data")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("falls back to the empty state for an sma that arrives non-finite", async () => {
    // A non-finite number that did arrive reads as no data, like a cold topic.
    const fixture = makeFixture();
    renderSma(fixture);

    act(() => {
      fixture.emit("vessel.orbit", { sma: 675_000, referenceBodyIndex: 1 });
    });
    await waitFor(() => expect(visibleText()).toContain("675.0 km"));

    act(() => {
      fixture.emit(
        "vessel.orbit",
        { sma: Number.NaN, referenceBodyIndex: 1 },
        { validAt: 5 },
      );
    });

    await waitFor(() =>
      expect(screen.getByText("No orbit data")).toBeInTheDocument(),
    );
  });

  it("drops the reference-body suffix while system.bodies has not arrived", async () => {
    // The body table has not landed, so the subtitle is the bare label.
    const fixture = makeFixture();
    renderSma(fixture);

    act(() => {
      fixture.emit("vessel.orbit", { sma: 675_000, referenceBodyIndex: 1 });
    });

    await waitFor(() => expect(visibleText()).toContain("675.0 km"));
    expect(screen.getByText("Semi-major axis")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("marks a confirmed-absent reference body rather than rendering it as still loading", async () => {
    const fixture = makeFixture();
    renderSma(fixture);

    act(() => {
      fixture.emit("vessel.orbit", { sma: 675_000, referenceBodyIndex: 1 });
      fixture.emit("system.bodies", null);
    });

    await waitFor(() => expect(visibleText()).toContain("675.0 km"));
    expect(
      screen.getByText(`Semi-major axis · ${NULL_DISPLAY}`),
    ).toBeInTheDocument();
  });

  it("drops the suffix when the body table arrived but does not contain the referenced index", async () => {
    // A whole table with no entry for index 1 renders the same bare subtitle again.
    const fixture = makeFixture();
    renderSma(fixture);

    act(() => {
      fixture.emit("vessel.orbit", { sma: 675_000, referenceBodyIndex: 1 });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Duna",
            index: 2,
            parentIndex: 0,
            radius: 320000,
            orbit: null,
          },
        ],
      });
    });

    await waitFor(() => expect(visibleText()).toContain("675.0 km"));
    expect(screen.getByText("Semi-major axis")).toBeInTheDocument();
    expect(screen.queryByText(/Duna/)).not.toBeInTheDocument();
  });
});
