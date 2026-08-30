import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CrewStatusComponent } from "./index";

/**
 * Characterisation, not specification: what CrewStatus DOES today when its
 * `useTelemetry` reads come back `undefined`.
 *
 * The widget has three distinct absence gates over one Topic (`vessel.crew`)
 * plus two more over `vessel.state` and `vessel.resources`:
 *
 *   1. `crew?.count` / `crew?.capacity` / `crew?.crew`, optional-chained off a
 *      possibly-undefined payload
 *   2. `known = crewCount !== undefined || crewCapacity !== undefined ||
 *      names.length > 0`, the whole-widget "anything at all yet" test
 *   3. `crewCount === undefined` inside `renderBody`, a SECOND gate that exists
 *      only because `known` can be true while the headcount is still missing
 *
 * Every one of them is written against `undefined` specifically, so each one
 * changes meaning when the read starts answering with a `Reading`.
 */

const CARRIED = [
  "vessel.crew",
  "vessel.state",
  "vessel.identity",
  "vessel.orbit",
  "vessel.resources",
];

// `vessel.identity.vesselType === 7` is the EVA kerbal type `deriveVesselState`
// maps onto `vessel.state.isEVA`, and the derived record only exists once
// `vessel.orbit` is whole, hence the minimal orbit alongside it.
const VESSEL_TYPE_EVA = 7;
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

const renderedTrees: Array<() => void> = [];

function newFixture() {
  return setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
    suspendFrames: true,
  });
}

function renderCrew(
  fixture: ReturnType<typeof newFixture>,
  size?: { w: number; h: number },
) {
  const { unmount, container } = render(
    <fixture.Provider>
      <CrewStatusComponent config={{}} id="crew" w={size?.w} h={size?.h} />
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return container;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

describe("CrewStatus, what undefined telemetry renders today", () => {
  it("renders the waiting placeholder and NO roster when nothing has arrived", () => {
    // Gate 2 (`known` false) firing on a cold widget. The placeholder wording
    // is the whole observable difference between "nothing yet" and every other
    // state, so it is pinned literally.
    const container = renderCrew(newFixture(), { w: 6, h: 8 });

    expect(screen.getByText("Waiting for telemetry...")).toBeInTheDocument();
    // Specifically not the confident conclusions the same body can draw: an
    // undefined headcount is NOT reported as an unmanned probe, and no roster
    // list element exists at all.
    expect(screen.queryByText(/Unmanned/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/names unavailable/i)).not.toBeInTheDocument();
    expect(container.querySelector("ul")).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("renders 'No crew data' at tiny size when nothing has arrived", () => {
    // Same `known` gate, the OTHER branch of the size split: at 3x3 the roster
    // body is skipped entirely and the cold state has different wording, so a
    // migration has two places to change and only one of them is above.
    renderCrew(newFixture(), { w: 3, h: 3 });

    expect(screen.getByText("No crew data")).toBeInTheDocument();
    expect(
      screen.queryByText(/Waiting for telemetry/i),
    ).not.toBeInTheDocument();
    // The hero "n of m aboard" readout is absent, not zeroed.
    expect(screen.queryByText(/aboard/i)).not.toBeInTheDocument();
  });

  it("REVERTS to the waiting placeholder when a confirmed tombstone lands on vessel.crew", async () => {
    // null-vs-undefined, and the widget does not distinguish them. The store
    // hands `useTelemetry` a literal `null` for a tombstoned Topic (`sample()`
    // finds the point, its payload is null), so `crew?.count` optional-chains
    // to undefined and every gate reads it as "nothing has arrived yet".
    //
    // A real roster is rendered FIRST so this cannot pass vacuously: the
    // tombstone has to be genuinely ingested and read for the roster to
    // disappear, which is what proves the confirmed-absence case collapses onto
    // the never-arrived one rather than merely sharing its wording.
    const fixture = newFixture();
    renderCrew(fixture, { w: 6, h: 8 });
    act(() => {
      fixture.emit(
        "vessel.crew",
        { count: 1, capacity: 1, crew: [{ name: "Jebediah Kerman" }] },
        { seq: 1, validAt: 1 },
      );
    });
    await waitFor(() =>
      expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument(),
    );

    act(() => {
      fixture.emit("vessel.crew", null, { seq: 2, validAt: 2 });
    });

    await waitFor(() =>
      expect(screen.getByText("Waiting for telemetry...")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Jebediah Kerman")).not.toBeInTheDocument();
    // Not "Unmanned": a confirmed no-crew tombstone is not reported as an
    // unmanned vessel, it is reported as no telemetry.
    expect(screen.queryByText(/Unmanned/i)).not.toBeInTheDocument();
  });

  it("keeps waiting when capacity arrives but the headcount field does not", async () => {
    // Gate 3: a PARTIAL payload. `known` is already true off `capacity`, so
    // only the second, field-level `crewCount === undefined` test stops the
    // widget concluding "Unmanned" about a crewed vessel.
    const fixture = newFixture();
    renderCrew(fixture, { w: 6, h: 8 });
    act(() => {
      fixture.emit("vessel.crew", { capacity: 4 });
    });

    await waitFor(() =>
      expect(screen.getByText("Waiting for telemetry...")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Unmanned/i)).not.toBeInTheDocument();
  });

  it("reports 'names unavailable' when the count arrives but the roster field does not", async () => {
    // Partial payload, the other field: an undefined `crew` array is reported
    // as a KNOWN headcount with withheld names, a genuinely different message
    // from either placeholder above.
    const fixture = newFixture();
    renderCrew(fixture, { w: 6, h: 8 });
    act(() => {
      fixture.emit("vessel.crew", { count: 2, capacity: 4 });
    });

    await waitFor(() =>
      expect(
        screen.getByText(/2 aboard, names unavailable/),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/Waiting for telemetry/i),
    ).not.toBeInTheDocument();
  });

  it("renders the headcount with NO capacity caption when only the count arrives, at tiny size", async () => {
    // Tiny-mode `crewCapacity !== undefined &&` gate: an undefined capacity
    // drops the whole "of n aboard" caption rather than showing a placeholder
    // denominator.
    const fixture = newFixture();
    renderCrew(fixture, { w: 3, h: 3 });
    act(() => {
      fixture.emit("vessel.crew", { count: 3 });
    });

    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
    expect(screen.queryByText(/aboard/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No crew data")).not.toBeInTheDocument();
  });

  it("renders an em dash for an undefined headcount when capacity alone arrives, at tiny size", async () => {
    // The one place an undefined read renders as visible punctuation rather
    // than a sentence: `known` is true off capacity, and the missing count
    // becomes NULL_DISPLAY beside a real "of 4 aboard" caption. A cheap textual
    // empty-state detector cannot see this state, which is why it is pinned.
    const fixture = newFixture();
    renderCrew(fixture, { w: 3, h: 3 });
    act(() => {
      fixture.emit("vessel.crew", { capacity: 4 });
    });

    await waitFor(() =>
      expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument(),
    );
    expect(screen.getByText(/aboard/i)).toBeInTheDocument();
  });

  it("omits the EVA suit meters when vessel.resources never arrives on an EVA kerbal", async () => {
    // `resources?.resources?.Oxygen` absence gate, isolated: everything else
    // the block needs is present (isEVA true, so the "EVA" caption renders),
    // and the undefined resources Topic silently removes the whole meter group
    // rather than drawing empty tanks.
    const fixture = newFixture();
    renderCrew(fixture, { w: 6, h: 8 });
    act(() => {
      fixture.emit("vessel.crew", {
        count: 1,
        capacity: 1,
        crew: [{ name: "Jebediah Kerman" }],
      });
      fixture.emit("vessel.orbit", ORBIT);
      fixture.emit("vessel.identity", { vesselType: VESSEL_TYPE_EVA });
    });

    await waitFor(() => expect(screen.getByText("EVA")).toBeInTheDocument());
    expect(
      screen.queryByLabelText("EVA suit resources"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("O2")).not.toBeInTheDocument();
    expect(screen.queryByText("EC")).not.toBeInTheDocument();
  });

  it("omits the EVA caption entirely when vessel.state never arrives", async () => {
    // `isEVA === true` gate: an undefined derived record is NOT rendered as
    // "not on EVA", the caption line is dropped, so nothing on screen states
    // the vessel's EVA standing either way.
    const fixture = newFixture();
    renderCrew(fixture, { w: 6, h: 8 });
    act(() => {
      fixture.emit("vessel.crew", {
        count: 1,
        capacity: 1,
        crew: [{ name: "Jebediah Kerman" }],
      });
    });

    await waitFor(() =>
      expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument(),
    );
    expect(screen.queryByText("EVA")).not.toBeInTheDocument();
  });
});
