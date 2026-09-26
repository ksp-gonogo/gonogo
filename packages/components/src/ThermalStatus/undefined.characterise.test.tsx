import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  type StreamFixture,
  setupStreamFixture,
} from "../test/setupStreamFixture";
import { ThermalStatusComponent } from "./index";

/**
 * Pins what ThermalStatus renders for each source of `undefined`: nothing streamed, a tombstoned channel, a missing field, and a field at the near-zero sentinel the widget itself drops.
 */
const CARRIED_CHANNELS = ["vessel.thermal"];

function renderThermal(fixture: StreamFixture) {
  return render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "therm-undef" }}>
        <ThermalStatusComponent config={{}} id="therm-undef" w={8} h={7} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
}

// Frames are suspended so the emitted record has landed by the time `act` returns, and an asserted absence is a real one.
function newFixture() {
  return setupStreamFixture({
    carriedChannels: CARRIED_CHANNELS,
    pinnedUt: 10,
    suspendFrames: true,
  });
}

describe("ThermalStatus: what undefined means today", () => {
  it("renders the empty state and NO readout rows at all when nothing has arrived", () => {
    const fixture = newFixture();
    const { container } = renderThermal(fixture);

    // The panel chrome draws either way, so the absences are named rather than read off an empty container.
    expect(screen.getByText("No thermal data")).toBeInTheDocument();
    expect(screen.getByText("THERMAL")).toBeInTheDocument();
    expect(screen.queryByText("Hottest part")).toBeNull();
    expect(screen.queryByText("Hottest engine")).toBeNull();
    expect(screen.queryByText("Heat shield")).toBeNull();
    // No band pill either: nothing-arrived does not read as "nominal" here.
    expect(screen.queryByText("nominal")).toBeNull();
    expect(visibleText(container)).not.toContain(NULL_DISPLAY);
  });

  it("draws the readout, not the empty state, when the record carries ONLY a critical ratio", async () => {
    // A present critical ratio clears `noData` on its own; the rows it cannot fill draw placeholders.
    const fixture = newFixture();
    renderThermal(fixture);

    act(() => {
      fixture.emit("vessel.thermal", { maxInternalTempRatio: 0.99 });
    });

    expect(screen.queryByText("No thermal data")).toBeNull();
    expect(screen.getByText("Hottest part")).toBeInTheDocument();
    // Named twice: the summary pill and the hottest-part band tag.
    expect(screen.getAllByText("critical")).toHaveLength(2);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("treats a tombstoned channel exactly as it treats one that never arrived", async () => {
    // A real record goes first so the tombstone is proven to have landed by driving the readout back to empty.
    const fixture = newFixture();
    renderThermal(fixture);

    act(() => {
      fixture.emit(
        "vessel.thermal",
        {
          hottestPart: { name: "LV-T30 'Reliant'", skinTemp: 500 },
          maxInternalTempRatio: 0.2,
        },
        { seq: 1, validAt: 9 },
      );
    });
    await waitFor(() =>
      expect(screen.getByText("LV-T30 'Reliant'")).toBeInTheDocument(),
    );

    // Stamped at the pinned view time: a tombstone stamped in the future is not sampled.
    act(() => {
      fixture.emit("vessel.thermal", null, { seq: 2, validAt: 10 });
    });

    await waitFor(() =>
      expect(screen.getByText("No thermal data")).toBeInTheDocument(),
    );
    expect(screen.queryByText("LV-T30 'Reliant'")).toBeNull();
  });

  it("converts a real name and temperature into absence when the temperature is at the sentinel floor", async () => {
    // A skin temperature below 50 K reads as "no part fitted", and the guard drops the part's name with its numbers.
    const fixture = newFixture();
    renderThermal(fixture);

    act(() => {
      fixture.emit("vessel.thermal", {
        hottestPart: {
          name: "OX-STAT Photovoltaic Panels",
          skinTemp: 2,
          skinMaxTemp: 2273,
        },
        maxInternalTempRatio: 0.001,
      });
    });

    expect(screen.getByText("No thermal data")).toBeInTheDocument();
    expect(screen.queryByText("OX-STAT Photovoltaic Panels")).toBeNull();
  });

  it("draws an unknown band, not a nominal one, when the ratio is missing", async () => {
    const fixture = newFixture();
    renderThermal(fixture);

    act(() => {
      fixture.emit("vessel.thermal", {
        hottestPart: { name: "LV-T30 'Reliant'", skinTemp: 500 },
      });
    });

    await waitFor(() =>
      expect(screen.getByText("LV-T30 'Reliant'")).toBeInTheDocument(),
    );
    // The summary pill and both band tags read "unknown", including the engine tag with no data at all.
    expect(screen.queryAllByText("nominal")).toHaveLength(0);
    expect(screen.getAllByText("unknown")).toHaveLength(3);
    // A missing ratio has no length to draw, so the meter draws its absent form: no fill and no aria-valuenow asserting one.
    expect(
      screen.queryByRole("meter", { name: "LV-T30 'Reliant'" }),
    ).toBeNull();
  });

  it("omits the '/ ... max' tag when the max temperature is missing, keeping the temperature", async () => {
    const fixture = newFixture();
    const { container } = renderThermal(fixture);

    act(() => {
      fixture.emit("vessel.thermal", {
        hottestPart: { name: "LV-T30 'Reliant'", skinTemp: 500 },
        maxInternalTempRatio: 0.2,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("LV-T30 'Reliant'")).toBeInTheDocument(),
    );
    expect(visibleText(container)).toContain("226.9 °C");
    expect(visibleText(container)).not.toContain("max");
  });

  it("renders the row skeleton with placeholders when hottestPart is null inside a present record", async () => {
    // One real field clears `noData`, so every row mounts and the empty ones draw placeholders.
    const fixture = newFixture();
    const { container } = renderThermal(fixture);

    act(() => {
      fixture.emit("vessel.thermal", {
        hottestPart: null,
        heatShieldTemp: 400,
        heatShieldFlux: 12,
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Heat shield")).toBeInTheDocument(),
    );
    expect(screen.getByText("Hottest part")).toBeInTheDocument();
    expect(screen.getByText("Hottest engine")).toBeInTheDocument();
    // The part name and both absent temperatures, each a placeholder.
    expect(screen.getAllByText(NULL_DISPLAY).length).toBeGreaterThanOrEqual(2);
    expect(visibleText(container)).toContain("126.9 °C");
  });
});
