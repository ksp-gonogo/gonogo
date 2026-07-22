import type { DataKey } from "@ksp-gonogo/core";
import {
  MockDataSource,
  registerAugment,
  registerDataSource,
  unregisterDataSource,
} from "@ksp-gonogo/core";
import { BufferedDataSource, MemoryStore } from "@ksp-gonogo/data";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@ksp-gonogo/test-utils";
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

/**
 * Kerbalism per-kerbal survival meters. These ride the legacy "data" source
 * (`crew.kerbals` + `ls.*`, same plumbing as LifeSupportSystems), so the
 * fixture here pairs the stream (for `vessel.crew`) with a registered
 * `MockDataSource`. Absent the KerbalismUplink there is no "data" source at
 * all and `useRaw` returns undefined — so the meters simply never render and
 * the roster behaves exactly as the tests above assert.
 */
describe("CrewManifestComponent — survival meters", () => {
  const SURVIVAL_KEYS: DataKey[] = [
    "crew.kerbals",
    "ls.food.amount",
    "ls.food.rate",
    "ls.water.amount",
    "ls.water.rate",
    "ls.oxygen.amount",
    "ls.oxygen.rate",
  ].map((key) => ({ key }));

  let source: MockDataSource;
  let buffered: BufferedDataSource;
  const trees: Array<() => void> = [];

  async function setup() {
    source = new MockDataSource({ keys: SURVIVAL_KEYS });
    buffered = new BufferedDataSource({ source, store: new MemoryStore() });
    registerDataSource(buffered);
    await buffered.connect();

    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.crew", "vessel.state"],
      pinnedUt: 10,
    });
    const { unmount } = render(
      <fixture.Provider>
        <CrewManifestComponent config={{}} id="crew" w={6} h={8} />
      </fixture.Provider>,
    );
    trees.push(unmount);
    return fixture;
  }

  afterEach(() => {
    for (const unmount of trees) unmount();
    trees.length = 0;
    buffered?.disconnect();
    unregisterDataSource("data");
  });

  it("renders per-kerbal dose + stress meters and a death-clock once toggled on", async () => {
    const fixture = await setup();
    act(() => {
      fixture.emit("vessel.crew", {
        count: 2,
        capacity: 2,
        crew: [{ name: "Jebediah Kerman" }, { name: "Bill Kerman" }],
      });
      // A life-support resource draining → stage-1 death-clock is a real time.
      source.emit("ls.food.amount", 0.35);
      source.emit("ls.food.rate", -0.000036);
      source.emit("crew.kerbals", [
        {
          name: "Jebediah Kerman",
          trait: "Pilot",
          rules: { radiation: 0.6, stress: 0.3 },
        },
        {
          name: "Bill Kerman",
          trait: "Engineer",
          rules: { radiation: 0.1, stress: 0.05 },
        },
      ]);
    });

    // Roster renders first; meters are off by default outside Flight, behind
    // the scene-aware toggle.
    await waitFor(() =>
      expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("meter", { name: "Dose" }),
    ).not.toBeInTheDocument();

    // Flip the toggle on and the per-kerbal meters appear.
    fireEvent.click(screen.getByRole("button", { name: /show meters/i }));

    const doseMeters = await screen.findAllByRole("meter", { name: "Dose" });
    expect(doseMeters).toHaveLength(2);
    expect(screen.getAllByRole("meter", { name: "Stress" })).toHaveLength(2);

    // Jeb's dose is 0.6 → 60% on his meter.
    const jebRow = screen.getByText("Jebediah Kerman").closest("li");
    expect(
      within(jebRow as HTMLElement).getByRole("meter", { name: "Dose" }),
    ).toHaveAttribute("aria-valuenow", "60");

    // Stage-1 death-clock headline while resources drain.
    expect(screen.getAllByText(/to LS depletion/i).length).toBeGreaterThan(0);
  });

  it("shows no meters toggle when no per-kerbal survival data is present", async () => {
    const fixture = await setup();
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
    expect(
      screen.queryByRole("button", { name: /meters/i }),
    ).not.toBeInTheDocument();
  });
});
