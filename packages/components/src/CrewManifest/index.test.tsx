import { registerAugment } from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { type CrewBadgeContext, CrewManifestComponent } from "./index";

/**
 * CrewManifest runs entirely off the stream: `vessel.crew`
 * (count/capacity/crew roster, read via the canonical one-arg `useTelemetry`)
 * plus the derived `vessel.state.isEVA` (from `vessel.identity.vesselType`,
 * read via `useStream`). No legacy `MockDataSource` is registered — a real
 * `TelemetryProvider`/`TimelineStore` pipeline feeds the widget via
 * `fixture.emit`.
 */

// `vessel.identity.vesselType === 7` is the EVA kerbal type deriveVesselState
// maps onto `vessel.state.isEVA` (see `vessel-state.ts`'s VESSEL_TYPE_EVA).
const VESSEL_TYPE_EVA = 7;

// `deriveVesselState` produces NO record until `vessel.orbit` is whole (it
// early-returns `undefined` otherwise), and every derived field — isEVA
// included — hangs off that record. A minimal orbit is emitted alongside
// `vessel.identity` so the record exists and the EVA flag can be derived.
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
    carriedChannels: [
      "vessel.crew",
      "vessel.state",
      "vessel.identity",
      "vessel.orbit",
    ],
    pinnedUt: 10,
  });
}

function renderCrew(fixture: ReturnType<typeof newFixture>) {
  const { unmount } = render(
    <fixture.Provider>
      <CrewManifestComponent config={{}} id="crew" />
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

describe("CrewManifestComponent", () => {
  it("shows the waiting placeholder until crew telemetry arrives", () => {
    renderCrew(newFixture());
    expect(screen.getByText(/Waiting for telemetry/i)).toBeInTheDocument();
  });

  it("lists crew names alongside count / capacity", async () => {
    const fixture = newFixture();
    renderCrew(fixture);
    act(() => {
      fixture.emit("vessel.crew", {
        count: 3,
        capacity: 4,
        crew: [
          { name: "Jebediah Kerman" },
          { name: "Bill Kerman" },
          { name: "Bob Kerman" },
        ],
      });
    });

    await waitFor(() =>
      expect(screen.getByText("3 / 4 aboard")).toBeInTheDocument(),
    );
    expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument();
    expect(screen.getByText("Bill Kerman")).toBeInTheDocument();
    expect(screen.getByText("Bob Kerman")).toBeInTheDocument();
  });

  it("shows the unmanned placeholder when crewCount is 0", async () => {
    const fixture = newFixture();
    renderCrew(fixture);
    act(() => {
      fixture.emit("vessel.crew", { count: 0, capacity: 0, crew: [] });
    });
    await waitFor(() =>
      expect(screen.getByText(/Unmanned/i)).toBeInTheDocument(),
    );
  });

  it("does not flash Unmanned when capacity arrives before count", async () => {
    const fixture = newFixture();
    renderCrew(fixture);
    // A partial payload — capacity present, count still undefined. The widget
    // must not conclude "Unmanned" from a still-undefined count.
    act(() => {
      fixture.emit("vessel.crew", { capacity: 4 });
    });
    await waitFor(() =>
      expect(screen.getByText(/Waiting for telemetry/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Unmanned/i)).not.toBeInTheDocument();

    act(() => {
      fixture.emit("vessel.crew", {
        count: 1,
        capacity: 4,
        crew: [{ name: "Jebediah Kerman" }],
      });
    });
    await waitFor(() =>
      expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument(),
    );
  });

  it("handles Kerbalism-style object payloads by extracting .name", async () => {
    const fixture = newFixture();
    renderCrew(fixture);
    act(() => {
      // Some mods return rich objects instead of plain strings — our guard
      // should fish out the name and ignore the rest.
      fixture.emit("vessel.crew", {
        count: 2,
        capacity: 2,
        crew: [
          { name: "Jebediah Kerman", health: 1.0 },
          { name: "Bill Kerman", health: 0.8 },
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument(),
    );
    expect(screen.getByText("Bill Kerman")).toBeInTheDocument();
  });

  it("surfaces EVA state in the subtitle", async () => {
    const fixture = newFixture();
    renderCrew(fixture);
    act(() => {
      fixture.emit("vessel.crew", {
        count: 1,
        capacity: 1,
        crew: [{ name: "Jebediah Kerman" }],
      });
      fixture.emit("vessel.orbit", ORBIT);
      fixture.emit("vessel.identity", { vesselType: VESSEL_TYPE_EVA });
    });
    await waitFor(() => expect(screen.getByText(/EVA/)).toBeInTheDocument());
  });

  it("renders the per-crew badges slot with no bound augment (empty is fine)", async () => {
    // No augment registered → the slot composes nothing and the roster renders
    // exactly as before, one row per kerbal.
    const fixture = newFixture();
    renderCrew(fixture);
    act(() => {
      fixture.emit("vessel.crew", {
        count: 2,
        capacity: 2,
        crew: [{ name: "Jebediah Kerman" }, { name: "Bill Kerman" }],
      });
    });
    await waitFor(() =>
      expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument(),
    );
    expect(screen.getByText("Bill Kerman")).toBeInTheDocument();
    expect(screen.queryByTestId("crew-badge")).not.toBeInTheDocument();
  });

  it("renders a bound augment once per crew row, carrying each kerbal's identity", async () => {
    // A test Uplink binds `crew-manifest.badges` and echoes the slot props back.
    // Proves (a) the slot is exposed, (b) an augment composes into it, and (c)
    // the per-row props carry the right kerbal so the badge lands on the right
    // one. `requires` is omitted so no Domain presence gate applies.
    registerAugment<"crew-manifest.badges">({
      id: "test-crew-badge",
      augments: "crew-manifest.badges",
      component: ({ crewName, crewIndex }: CrewBadgeContext) => (
        <span data-testid="crew-badge" data-index={crewIndex}>
          {crewName} ✓
        </span>
      ),
    });

    const fixture = newFixture();
    renderCrew(fixture);
    act(() => {
      fixture.emit("vessel.crew", {
        count: 3,
        capacity: 3,
        crew: [
          { name: "Jebediah Kerman" },
          { name: "Bill Kerman" },
          { name: "Bob Kerman" },
        ],
      });
    });

    const badges = await screen.findAllByTestId("crew-badge");
    expect(badges).toHaveLength(3);
    expect(badges.map((b) => b.textContent)).toEqual([
      "Jebediah Kerman ✓",
      "Bill Kerman ✓",
      "Bob Kerman ✓",
    ]);
    // Each badge sits inside its own kerbal's row (props identity is correct).
    const jebRow = screen.getByText("Jebediah Kerman").closest("li");
    expect(jebRow).not.toBeNull();
    expect(
      within(jebRow as HTMLElement).getByTestId("crew-badge"),
    ).toHaveTextContent("Jebediah Kerman ✓");
  });
});
