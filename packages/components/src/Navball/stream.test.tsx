import { clearActionHandlers, DashboardItemContext } from "@gonogo/core";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { NavballComponent } from "./index";

/**
 * The M3 batch-1 stream test-adapter proof for Navball (mirrors
 * `WarpControl/stream.test.tsx`, the pilot): the widget genuinely running
 * off the real `TelemetryProvider`/`TelemetryClient`/`TimelineStore`
 * pipeline via `StubTransport` — no legacy `DataSource` is registered
 * anywhere in this file, so a value that only ever arrived via the shim's
 * legacy fallback would leave the readouts stuck at their loading
 * placeholder ("—") forever.
 *
 * Navball's `dataRequirements` split MAPPED / GAPPED (`map-topic.ts`'s
 * `TELEMACHUS_CLEAN_HOMES`/`TELEMACHUS_KNOWN_GAPS`):
 * - MAPPED: `n.heading`/`n.pitch`/`n.roll` -> `vessel.attitude.*`;
 *   `f.sasEnabled` -> `vessel.control.sas`; `v.rcsValue` ->
 *   `vessel.control.rcs`; `f.throttle` -> `vessel.control.throttle`.
 * - GAPPED (stay legacy forever until a gap lands — not exercised here
 *   since no legacy source exists in this file): `n.heading2`/`n.pitch2`/
 *   `n.roll2` (the CoM-frame quartet, V-9), `f.precisionControl`,
 *   `v.isControllable`, `v.angleToPrograde`, and — as of the M3 batch-2
 *   fixture audit — `f.sasMode` (shape mismatch: the real
 *   `vessel.control.sasMode` is a numeric enum, not the string this widget
 *   renders/compares against; see `map-topic.ts`). The `vessel.control`
 *   payload below carries a realistic numeric `sasMode` to match the real
 *   wire, but since the widget's own `sasMode` read stays gapped-to-legacy,
 *   this stream-only file (no legacy source registered) can't resolve it —
 *   the mode caption stays absent, asserted below.
 *
 * Sized at 8x4 (rows < 6) so the numeric HDG/PCH/RLL readout renders
 * instead of the SVG dial — the dial's tick geometry isn't useful to assert
 * against in a stream-vs-legacy proof; the numeric branch is textual and
 * exercises the exact same `heading`/`pitch`/`roll` reads.
 */
afterEach(() => {
  cleanup();
  clearActionHandlers();
});

describe("Navball — genuinely runs off the stream (M3 batch 1)", () => {
  it("reads attitude + control state off the real stream pipeline, not legacy", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.attitude", "vessel.control"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "nav-stream" }}>
          <NavballComponent id="nav-stream" w={8} h={4} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    // Nothing arrived yet — the numeric readouts show the loading placeholder.
    expect(screen.getByText("HDG").nextSibling?.textContent).toBe("—");

    // A real subscription must have happened for this to deliver at all —
    // StubTransport.emit is subscription-gated (see its own doc comment).
    expect(fixture.transport.isSubscribed("vessel.attitude")).toBe(true);
    expect(fixture.transport.isSubscribed("vessel.control")).toBe(true);

    act(() => {
      fixture.emit("vessel.attitude", { heading: 87.4, pitch: 12, roll: -5 });
      fixture.emit("vessel.control", {
        sas: true,
        // Real wire shape: numeric SasMode enum (1 = Prograde) — f.sasMode
        // is a known gap (map-topic.ts), so this doesn't reach the widget's
        // own sasMode read; included only so the payload matches the real
        // contract shape.
        sasMode: 1,
        rcs: false,
        throttle: 0.6,
      });
    });

    await waitFor(() => expect(screen.getByText("87°")).toBeTruthy());
    expect(screen.getByText("+12°")).toBeTruthy();
    expect(screen.getByText("-5°")).toBeTruthy();
    // f.sasEnabled -> vessel.control.sas: SAS badge lights up. f.sasMode is
    // gapped (no legacy source in this stream-only file), so the mode
    // caption stays absent — "SAS" alone, not "SAS: Prograde".
    expect(screen.getByText("SAS")).toBeTruthy();
  });
});
