import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

/**
 * The stream test-adapter proof for Navball (mirrors
 * `WarpControl/stream.test.tsx`, the pilot): the widget genuinely running
 * off the real `TelemetryProvider`/`TelemetryClient`/`TimelineStore`
 * pipeline via `StubTransport`: no legacy `DataSource` is registered
 * anywhere in this file, so a value that only ever arrived via the shim's
 * legacy fallback would leave the readouts stuck at their loading
 * placeholder (NULL_DISPLAY) forever.
 *
 * Navball's `dataRequirements` split MAPPED / GAPPED (`map-topic.ts`'s
 * `LEGACY_KEY_HOMES`/`LEGACY_KEY_GAPS`):
 * - MAPPED: `n.heading`/`n.pitch`/`n.roll` -> `vessel.attitude.*` (the
 *   CoM-referenced frame); `n.heading2`/`n.pitch2`/`n.roll2` ->
 *   `vessel.attitude.*RootFrame` (the genuinely distinct root-part frame:
 *   which the DEFAULT `useCoMFrame: false` config reads, see the widget's
 *   own ternary comment); `f.sasEnabled` -> `vessel.control.sas`;
 *   `v.rcsValue` -> `vessel.control.rcs`; `f.throttle` ->
 *   `vessel.control.throttle`; `f.precisionControl` ->
 *   `vessel.control.precisionControl` (un-gapped, shared with ActionGroup's
 *   precision-control read).
 * - `f.sasMode` -> `vessel.control.sasMode`, the numeric enum the wire
 *   carries, resolved to its name against the contract's own table. The
 *   `vessel.control` payload below carries a realistic ordinal and the mode
 *   caption reads it, asserted below.
 * - `v.isControllable` -> `vessel.comms.controlState`, collapsed to a control
 *   level; not exercised here, no comms payload in this file.
 *
 * Sized at 8x4 (rows < 6) so the numeric HDG/PCH/RLL readout renders
 * instead of the SVG dial: the dial's tick geometry isn't useful to assert
 * against in a stream-vs-legacy proof; the numeric branch is textual and
 * exercises the exact same `heading`/`pitch`/`roll` reads. The DEFAULT
 * config (no `useCoMFrame` set → false → root-part frame) reads the
 * `*RootFrame` fields, so the fixture emits those; the base CoM fields are
 * emitted too (present on the real wire) but not read by the default.
 */
afterEach(() => {
  clearActionHandlers();
});

describe("Navball: genuinely runs off the stream (M3 batch 1)", () => {
  it("reads attitude + control state off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.attitude", "vessel.control"],
      pinnedUt: 10,
      suspendFrames: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "nav-stream" }}>
          <NavballComponent id="nav-stream" w={8} h={4} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet: the numeric readouts show the loading placeholder.
    // Read off the CELL rather than the label's next sibling: the reading and
    // its label swap places between the readout's two presentations, so a
    // sibling walk pins the layout rather than the value.
    expect(screen.getByText("HDG").parentElement?.textContent).toContain(
      NULL_DISPLAY,
    );

    // A real subscription must have happened for this to deliver at all,
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.attitude")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.control")).toBe(true);

    act(() => {
      // The default config reads the root-part frame (*RootFrame); the base
      // CoM fields are on the real wire too, so both are emitted. Distinct
      // values prove the default reads the root-frame trio, not the CoM one.
      fixture.emit("vessel.attitude", {
        heading: 200,
        pitch: 40,
        roll: 30,
        headingRootFrame: 87.4,
        pitchRootFrame: 12,
        rollRootFrame: -5,
      });
      fixture.emit("vessel.control", {
        sas: true,
        // The wire shape: a numeric SasMode ordinal, 1 being Prograde.
        sasMode: 1,
        rcs: false,
        precisionControl: true,
        throttle: 0.6,
      });
    });

    await waitFor(() => expect(visibleText()).toContain("87°"));
    expect(visibleText()).toContain("+12°");
    expect(visibleText()).toContain("-5°");
    // Both halves off the one topic: `sas` says the arm is on and `sasMode`
    // says which mode it is holding, so the toggle names the mode rather than
    // reporting a bare ON that discards what the wire already said.
    expect(screen.getByRole("button", { name: "SAS: PRO" })).toBeTruthy();
    // f.precisionControl -> vessel.control.precisionControl (un-gapped):
    // the PRECISION chip lights up off the stream alone, no legacy source
    // registered in this file.
    expect(screen.getByRole("button", { name: "PRECISION" })).toBeTruthy();
  });
});
