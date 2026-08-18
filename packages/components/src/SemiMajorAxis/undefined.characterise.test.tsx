import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SemiMajorAxisComponent } from "./index";

/**
 * What `undefined` MEANS at this widget's two telemetry reads, as the code
 * stands today.
 *
 * Recorded before `useTelemetry` becomes a `Reading` union: every branch below
 * turns on a value being `undefined` or falsy, and a `Reading` is always
 * truthy.
 *
 * The gates:
 * - `sma === undefined || !Number.isFinite(sma.magnitude)` (index.tsx:84) is
 *   the whole-widget gate. One "No orbit data" empty state covers at least
 *   four distinct facts: nothing has arrived, the record arrived without an
 *   sma, the topic is a confirmed tombstone, and the number arrived non-finite
 * - `useStream<VesselState>("vessel.state")?.referenceBodyName ?? undefined`
 *   (index.tsx:28) then `referenceBody ? " · X" : ""` (index.tsx:97) collapses
 *   the derived channel's deliberate `null`-versus-`undefined` distinction
 *   back into one rendering
 */

// `vessel.state.referenceBodyName` is only carried once all eight inputs are,
// so the subtitle suffix needs the full list even though only two are fed.
const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
];

function renderSma(fixture: ReturnType<typeof setupStreamFixture>) {
  // w=5,h=6 clears both the subtitle threshold (rows>=5, cols>=4) and the
  // sparkline one (rows>=4, cols>=3), so anything missing below is missing
  // because of a data gate rather than a size gate.
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
    carriedChannels: VESSEL_STATE_INPUTS,
    pinnedUt: 10,
  });
}

describe("SemiMajorAxis: what undefined means today", () => {
  it("renders the empty state and NONE of the readout furniture before anything arrives", async () => {
    // The nothing-has-arrived case in full. Asserted by naming the elements
    // that are gone rather than by an empty container: the whole `Body`
    // subtree is behind the gate, so the live-region readout, the sparkline
    // and the caption all vanish together.
    const fixture = makeFixture();
    const { container } = renderSma(fixture);

    expect(await screen.findByText("No orbit data")).toBeInTheDocument();
    // SmaDisplay carries role=status aria-live=polite: no readout element
    // exists at all, so a screen reader is told nothing rather than "unknown".
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.querySelector("svg[aria-label='SMA trend']")).toBeNull();
    expect(screen.queryByText(/Semi-major axis/)).not.toBeInTheDocument();
    // The panel frame survives, so the operator sees a titled tile.
    expect(screen.getByText("SMA")).toBeInTheDocument();
  });

  it("falls back to the empty state when a later orbit record arrives without an sma field", async () => {
    // Partial payload, one field deep. A live reading is established first so
    // the second frame is provably delivered: the readout then DISAPPEARS,
    // which is how "the record is here, the field is not" renders. Identical
    // to the cold-topic render above.
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
    // null-versus-undefined at the WHOLE-TOPIC read. A null payload is the
    // store's confirmed "there is no orbit" (what the Reading union calls
    // `absent`), and `useTelemetry(...)?.sma` optional-chains it straight into
    // the same undefined the cold case produces. This widget implements no
    // distinction between "no orbit, confirmed" and "no orbit data yet": the
    // established readout simply vanishes back to the loading-shaped message.
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
    // The `!Number.isFinite(sma.magnitude)` half of the gate. A garbage number
    // that DID arrive reads as no data at all, so a broken provider and a cold
    // topic look identical.
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
    // `referenceBody` is undefined because the body table has not landed, so
    // the subtitle is the bare label. Absence of the suffix is the widget's
    // only way of saying "body unknown".
    const fixture = makeFixture();
    renderSma(fixture);

    act(() => {
      fixture.emit("vessel.orbit", { sma: 675_000, referenceBodyIndex: 1 });
    });

    await waitFor(() => expect(visibleText()).toContain("675.0 km"));
    expect(screen.getByText("Semi-major axis")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("renders a confirmed-absent reference body identically to one that never arrived", async () => {
    // null-versus-undefined at the DERIVED read, and this one is a distinction
    // the producer went out of its way to make: `resolveBodyName` returns
    // `null` only when `system.bodies` is an outright tombstone, and
    // `undefined` for every not-yet-resolvable case. The widget's
    // `?? undefined` throws that away, so a confirmed "there is no body table"
    // renders as the same bare subtitle as "the table is still loading".
    const fixture = makeFixture();
    renderSma(fixture);

    act(() => {
      fixture.emit("vessel.orbit", { sma: 675_000, referenceBodyIndex: 1 });
      fixture.emit("system.bodies", null);
    });

    await waitFor(() => expect(visibleText()).toContain("675.0 km"));
    expect(screen.getByText("Semi-major axis")).toBeInTheDocument();
    expect(screen.queryByText(/Kerbin/)).not.toBeInTheDocument();
  });

  it("drops the suffix when the body table arrived but does not contain the referenced index", async () => {
    // Partial payload at the table level: `system.bodies` is present and whole,
    // it simply has no entry for index 1. `resolveBodyName`'s `?? undefined`
    // and then the widget's own falsy check produce the same bare subtitle
    // again, a third fact folded into one rendering.
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
