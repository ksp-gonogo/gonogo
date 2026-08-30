import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CommSignalComponent } from "./index";

/**
 * What CommSignal DOES today when its telemetry reads are `undefined`, recorded
 * before `useTelemetry` becomes a `Reading`.
 *
 * Four reads, each with its own undefined-meaning:
 *  - `useTelemetry("comms.link")?.connected` and
 *    `useTelemetry("vessel.comms")?.signalStrength`: `undefined` covers both
 *    "no record yet" and "record arrived without the field"
 *  - `vesselState?.commsControlStateOrdinal ?? undefined`: the derived channel
 *    means `null` = confirmed tombstone and `undefined` = not arrived, and this
 *    site deliberately flattens the two
 *  - `useTelemetry("comms.delay")?.oneWaySeconds`, gated by `delay == null`,
 *    which also flattens tombstone and never-arrived
 *
 * The `hasData` gate (`connected !== undefined || strength !== undefined ||
 * controlState !== undefined`) is the highest-value site in the file: after the
 * migration a `Reading` is always truthy, so a gate written against `undefined`
 * stops gating.
 */

// `deriveVesselState` emits no record at all until `vessel.orbit` is whole, and
// the commsControlState fields hang off that record, so a test that wants the
// derived control-state reads to resolve (to a value, to `null`, or to
// `undefined`) has to feed an orbit first.
const ORBIT = {
  sma: 682500,
  ecc: 0.00367,
  inc: 0.3,
  argPe: 12.5,
  mu: 3.5316e12,
  meanAnomalyAtEpoch: 0,
  epoch: 10,
  referenceBodyIndex: 1,
};

// `Sitrep.Contract.ControlState` ordinals: 4 = Full (collapses to level 2),
// 11 = Unknown (name resolves, level collapses to `undefined`).
const CONTROL_STATE_FULL = 4;
const CONTROL_STATE_UNKNOWN = 11;

const CARRIED = [
  "comms.link",
  "vessel.comms",
  "comms.delay",
  "vessel.state",
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.propulsion",
  "vessel.flight",
];

const teardowns: Array<() => void> = [];

function renderComm() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
    suspendFrames: true,
  });
  const rendered = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "comm-undef" }}>
        <CommSignalComponent config={{}} id="comm-undef" w={6} h={5} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  teardowns.push(rendered.unmount);
  return { fixture, ...rendered };
}

afterEach(() => {
  for (const teardown of teardowns) teardown();
  teardowns.length = 0;
});

describe("CommSignal: what undefined means today", () => {
  it("renders the no-signal empty state and NO readout when nothing has arrived", () => {
    const { container } = renderComm();

    // The `hasData` absence gate firing: this is the whole widget body being
    // withheld because three reads are `undefined`.
    expect(screen.getByText("No signal data")).toBeInTheDocument();
    // Specifically absent, not merely "an empty container": the bars chart, the
    // Control/Delay rows and the connection announcement are all suppressed.
    expect(screen.queryByLabelText(/^Signal \d of 4$/)).toBeNull();
    expect(screen.queryByText("Control")).toBeNull();
    expect(screen.queryByText("Delay")).toBeNull();
    expect(screen.queryByText("Signal to KSC")).toBeNull();
    expect(screen.queryByText("No signal")).toBeNull();
    // The panel title still renders, so the widget is present, not unmounted.
    expect(visibleText(container)).toContain("COMMNET");
  });

  it("still reports no signal data when only the delay has arrived", async () => {
    const { fixture } = renderComm();

    act(() => {
      fixture.emit("comms.delay", { oneWaySeconds: 1.2 });
    });

    // `comms.delay` is not one of the three reads `hasData` consults, so a live
    // measured delay does not lift the empty state: the delay value is simply
    // never drawn. Pins that the gate is a three-read gate, not an any-read one.
    await waitFor(() =>
      expect(screen.getByText("No signal data")).toBeTruthy(),
    );
    expect(visibleText()).not.toContain("1s");

    // The delay really was in the store the whole time, so the assertion above
    // records a firing gate rather than a dropped emit: lifting `hasData` with
    // one unrelated read reveals the value that was already there.
    act(() => {
      fixture.emit("comms.link", { connected: true });
    });
    await waitFor(() => expect(visibleText()).toContain("1s"));
  });

  it("draws zero bars in the OK tone with an em-dash headline when only connected arrives", async () => {
    const { fixture } = renderComm();

    act(() => {
      fixture.emit("comms.link", { connected: true });
    });

    // `hasData` now passes on `connected` alone, and every other read is still
    // `undefined`. The result is the fail-open render this pass exists to make
    // visible: a confident "Signal to KSC" / "Signal connected" beside ZERO lit
    // bars, because the bars fall all the way through to the `else` branch when
    // both strength and control state are absent.
    await waitFor(() =>
      expect(screen.getByLabelText("Signal 0 of 4")).toBeTruthy(),
    );
    expect(screen.getByText("Signal to KSC")).toBeTruthy();
    expect(screen.getByText("Signal connected")).toBeTruthy();
    // `describeControl(undefined, undefined)` resolves to NULL_DISPLAY, which
    // falls through its name tests to the "ok" tone. Headline and the Control
    // row are both the em dash, and the Delay row is a third.
    expect(screen.getAllByText(NULL_DISPLAY).length).toBe(3);
    expect(screen.queryByText("LOS")).toBeNull();
  });

  it("reports no signal data when the control-state NAME resolves but its ordinal does not", async () => {
    const { fixture } = renderComm();

    act(() => {
      fixture.emit("vessel.orbit", ORBIT);
      // ControlState.Unknown: `commsControlStateName` resolves to "Unknown",
      // `commsControlStateOrdinal` collapses to `undefined` (no level).
      fixture.emit("vessel.comms", { controlState: CONTROL_STATE_UNKNOWN });
    });

    // Only the ORDINAL feeds `hasData`, so the widget withholds its whole body
    // even though a control-state string is available to render. The name read
    // being `undefined`-or-not is invisible to the gate.
    await waitFor(() =>
      expect(screen.getByText("No signal data")).toBeTruthy(),
    );
    expect(screen.queryByText("Unknown")).toBeNull();
  });

  it("collapses a live readout back to the never-arrived empty state on a vessel.comms tombstone", async () => {
    const { fixture } = renderComm();

    // Start from a live readout, so the collapse below is observably caused by
    // the tombstone rather than by nothing ever having arrived.
    act(() => {
      fixture.emit("vessel.orbit", ORBIT);
      fixture.emit("vessel.comms", {
        signalStrength: 0.9,
        controlState: CONTROL_STATE_FULL,
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy(),
    );

    act(() => {
      // A whole-topic tombstone: the subject says there is no comms record.
      // `commsControlStateOrdinal` becomes `null`, which the widget's
      // `?? undefined` flattens into the never-arrived case on purpose (its own
      // comment says the semantics must match the old legacy read exactly).
      fixture.emit("vessel.comms", null);
    });

    // So a CONFIRMED "this vessel has no comms" is rendered as "nothing has come
    // through yet". The tombstone is the only thing that could have produced
    // this, which is what makes it a null-vs-undefined pin and not a no-op emit.
    await waitFor(() =>
      expect(screen.getByText("No signal data")).toBeTruthy(),
    );
    expect(screen.queryByLabelText(/^Signal \d of 4$/)).toBeNull();
  });

  it("falls back to the control state when the record arrived without a signalStrength", async () => {
    const { fixture } = renderComm();

    act(() => {
      fixture.emit("vessel.orbit", ORBIT);
      // Partial payload: the record exists, the strength field within it does
      // not. Distinct from the record being absent, and rendered differently:
      // the bars come off the control state instead of the percentage.
      fixture.emit("vessel.comms", { controlState: CONTROL_STATE_FULL });
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy(),
    );
    // Headline is the control label, not a percentage, because `pct` is null.
    expect(screen.getAllByText("Full").length).toBeGreaterThanOrEqual(1);
    expect(visibleText()).not.toContain("%");
  });

  it("reads a genuine zero signalStrength as no strength reading at all", async () => {
    const { fixture } = renderComm();

    act(() => {
      fixture.emit("vessel.orbit", ORBIT);
      // `strengthValid` requires `raw > 0`, so an observed zero is discarded by
      // the same test that discards an absent field: 0 % is never rendered.
      fixture.emit("vessel.comms", {
        signalStrength: 0,
        controlState: CONTROL_STATE_FULL,
      });
    });

    // Four bars from the control-state fallback, not zero bars from the zero
    // strength: the observed zero is invisible to the readout.
    await waitFor(() =>
      expect(screen.getByLabelText("Signal 4 of 4")).toBeTruthy(),
    );
    expect(visibleText()).not.toContain("0 %");
  });

  it("renders the delay placeholder for an absent record, an absent field, and a null field alike", async () => {
    const { fixture } = renderComm();

    act(() => {
      fixture.emit("comms.link", { connected: true });
    });
    await waitFor(() => expect(screen.getByText("Delay")).toBeTruthy());

    // 1. No `comms.delay` record at all.
    const rowsWithNoRecord = screen.getAllByText(NULL_DISPLAY).length;
    expect(rowsWithNoRecord).toBe(3);

    // 2. The record arrives WITHOUT the field (partial payload).
    act(() => {
      fixture.emit("comms.delay", {});
    });
    await waitFor(() =>
      expect(screen.getAllByText(NULL_DISPLAY).length).toBe(3),
    );

    // 3. The field arrives as an explicit `null` (no measurable ControlPath).
    // `delay == null` catches all three, so the widget's own comment is right
    // that null and undefined read identically here: nothing distinguishes a
    // confirmed "no path" from "nothing has arrived".
    act(() => {
      fixture.emit("comms.delay", { oneWaySeconds: null });
    });
    await waitFor(() =>
      expect(screen.getAllByText(NULL_DISPLAY).length).toBe(3),
    );
  });
});
