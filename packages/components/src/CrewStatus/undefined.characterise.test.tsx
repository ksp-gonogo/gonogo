import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CrewStatusComponent } from "./index";

/**
 * Characterisation, not specification: what CrewStatus renders when its reads are absent.
 * `renderBody` checks `crewCount === undefined` separately because `known` can be true before the headcount lands.
 */

// `vessel.identity.vesselType === 7` is `VesselType.EVA`, the kerbal on EVA.
const VESSEL_TYPE_EVA = 7;

const renderedTrees: Array<() => void> = [];

function newFixture() {
  return setupStreamFixture({
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
    // The placeholder wording is the only difference between "nothing yet" and every other state, so it is pinned literally.
    const container = renderCrew(newFixture(), { w: 6, h: 8 });

    expect(screen.getByText("Waiting for telemetry...")).toBeInTheDocument();
    // An undefined headcount is not an unmanned probe, and no roster list exists.
    expect(screen.queryByText(/Unmanned/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/names unavailable/i)).not.toBeInTheDocument();
    expect(container.querySelector("ul")).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("renders 'No crew data' at tiny size when nothing has arrived", () => {
    // The tiny-size branch of the same gate has its own cold-state wording.
    renderCrew(newFixture(), { w: 3, h: 3 });

    expect(screen.getByText("No crew data")).toBeInTheDocument();
    expect(
      screen.queryByText(/Waiting for telemetry/i),
    ).not.toBeInTheDocument();
    // The hero "n of m aboard" readout is absent, not zeroed.
    expect(screen.queryByText(/aboard/i)).not.toBeInTheDocument();
  });

  it("REVERTS to the waiting placeholder when a confirmed tombstone lands on vessel.crew", async () => {
    // A tombstone (null payload) collapses onto the never-arrived state. A roster renders first so this cannot pass vacuously.
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
    // Not "Unmanned": a confirmed no-crew tombstone is not reported as an unmanned vessel, it is reported as no telemetry.
    expect(screen.queryByText(/Unmanned/i)).not.toBeInTheDocument();
  });

  it("keeps waiting when capacity arrives but the headcount field does not", async () => {
    // Partial payload: `known` is true off capacity, so only the field-level headcount check stops a false "Unmanned".
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
    // A known headcount with no roster is reported as withheld names, distinct from either placeholder.
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
    // An undefined capacity drops the whole caption rather than showing a placeholder denominator.
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
    // The one undefined read that renders as punctuation, invisible to a textual empty-state detector, hence pinned.
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
    // Everything else is present, so this isolates the resources gate: no meters rather than empty tanks.
    const fixture = newFixture();
    renderCrew(fixture, { w: 6, h: 8 });
    act(() => {
      fixture.emit("vessel.crew", {
        count: 1,
        capacity: 1,
        crew: [{ name: "Jebediah Kerman" }],
      });
      fixture.emit("vessel.identity", { vesselType: VESSEL_TYPE_EVA });
    });

    await waitFor(() =>
      expect(screen.getByText(/Jebediah Kerman/)).toBeInTheDocument(),
    );
    expect(
      screen.queryByLabelText("EVA suit resources"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("O2")).not.toBeInTheDocument();
    expect(screen.queryByText("EC")).not.toBeInTheDocument();
  });

  it("omits the EVA caption entirely when vessel.identity never arrives", async () => {
    // An absent identity is not "not on EVA": the caption line is dropped.
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
