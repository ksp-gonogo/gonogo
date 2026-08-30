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
 * What `undefined` MEANS to ThermalStatus today, recorded before
 * `useTelemetry` starts returning a `Reading`.
 *
 * Every read in this widget is one `useTelemetry("vessel.thermal")` plus
 * optional chaining down the record, so `undefined` arrives at the render from
 * four different situations that the widget currently cannot tell apart:
 * nothing has streamed, the channel was tombstoned, the record arrived without
 * the field, and the field arrived carrying a near-absolute-zero sentinel the
 * widget itself converts to `undefined`. All four collapse into the same
 * absence, and the `noData` gate then decides between an empty state and a
 * fully-drawn nominal readout. These tests pin which of those it does for each.
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

/**
 * Frames are SUSPENDED, which is what lets the assertions below be about the
 * widget rather than about timing.
 *
 * A sample reaches the render on a frame, not on the emit, so an assertion made
 * straight after `fixture.emit` used to read the widget as it was BEFORE the
 * record arrived. That is survivable for a test asserting a presence, which
 * retries until the frame lands, and silently fatal for one asserting an
 * absence, which passes on the pre-emit render whatever the widget does. This
 * file used to wait two real animation frames for the loop to get round to it;
 * a suspended fixture mints the frame as part of the emit, so the record has
 * landed by the time `act` returns and an absence is a real absence.
 */
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

    // `noData` reads every one of its inputs as undefined, so the entire Body
    // (pill row + readout rows) is never mounted. Named absences rather than an
    // empty container: the widget draws its panel chrome either way.
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
    // `maxInternalTempRatio` IS one of the fields the `noData` gate consults, so
    // a record saying the hottest part sits at 99% of its limit clears the gate
    // on its own: a present, critical number is not suppressed by the absent
    // ones around it. The rows it cannot fill draw placeholders instead.
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
    // `null` vs `undefined`: the store delivers a tombstone as a `null`
    // payload, and every read here is `thermal?.field`, so a CONFIRMED absence
    // and a never-arrived channel produce the identical five words. The widget
    // implements no distinction between the two.
    //
    // A real record goes first so the tombstone is proven to have LANDED: the
    // readout has to be driven back to the empty state, which a dropped emit
    // could not do.
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

    // Stamped at the pinned view time, so it is the newest point the frame can
    // sample: a tombstone stamped in the FUTURE is simply not sampled and the
    // widget would keep drawing the old record.
    act(() => {
      fixture.emit("vessel.thermal", null, { seq: 2, validAt: 10 });
    });

    await waitFor(() =>
      expect(screen.getByText("No thermal data")).toBeInTheDocument(),
    );
    expect(screen.queryByText("LV-T30 'Reliant'")).toBeNull();
  });

  it("converts a real name and temperature into absence when the temperature is at the sentinel floor", async () => {
    // The widget MANUFACTURES undefined here: a skin temperature below 50 K is
    // read as "no part fitted", and the guard drops the part's NAME along with
    // its numbers, so a record that did arrive renders as though nothing had.
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

  /**
   * Recorded prior behaviour: "draws a confident nominal band and an empty bar
   * when the ratio is missing". `bandFromRatio(undefined)` returned "nominal",
   * so a part at 500 K with no ratio on the wire read as reassuringly nominal in
   * the pill and in both band tags, green tone and all. An engine row with no
   * data whatsoever also said "nominal".
   *
   * A green NOMINAL is a positive claim that nothing is overheating. There is now
   * an `unknown` band for the case where the widget has not been told.
   */
  it("draws an unknown band, not a nominal one, when the ratio is missing", async () => {
    const fixture = newFixture();
    const { container } = renderThermal(fixture);

    act(() => {
      fixture.emit("vessel.thermal", {
        hottestPart: { name: "LV-T30 'Reliant'", skinTemp: 500 },
      });
    });

    await waitFor(() =>
      expect(screen.getByText("LV-T30 'Reliant'")).toBeInTheDocument(),
    );
    // Nothing claims nominal, because nothing measured says so. Three places
    // read "unknown": the summary pill, the hottest-part band tag and the engine
    // band tag, the last of which has no data at all.
    expect(screen.queryAllByText("nominal")).toHaveLength(0);
    expect(screen.getAllByText("unknown")).toHaveLength(3);
    // The bar still reads zero-width. A missing ratio has no length to draw and
    // the band tag beside it now carries the "we do not know" part, so this is
    // left alone: it is the band that was making the false claim, not the bar.
    expect(container.querySelector('[style*="width: 0%"]')).not.toBeNull();
  });

  it("omits the '/ … max' tag when the max temperature is missing, keeping the temperature", async () => {
    // `hottestMaxK !== undefined` is the gate. Absent max means no denominator
    // is drawn at all, and the bare temperature is left to read as if it were
    // the whole story.
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
    // Partial payload: the record arrived, one nested record inside it is a
    // confirmed null, and one unrelated field (the heat shield) is real. The
    // real field is enough to clear `noData`, so every row mounts, and the
    // rows with nothing behind them render placeholders rather than dropping.
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
