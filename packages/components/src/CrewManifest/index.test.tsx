import { clearAugments, registerAugment } from "@ksp-gonogo/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  type CrewAvatarContext,
  type CrewBadgeContext,
  CrewManifestComponent,
} from "./index";

/**
 * CrewManifest runs entirely off the stream: `vessel.crew`
 * (count/capacity/crew roster, read via the canonical one-arg `useTelemetry`)
 * plus the derived `vessel.state.isEVA` (from `vessel.identity.vesselType`,
 * read via `useStream`). No legacy `MockDataSource` is registered, a real
 * `TelemetryProvider`/`TimelineStore` pipeline feeds the widget via
 * `fixture.emit`.
 */

// `vessel.identity.vesselType === 7` is the EVA kerbal type deriveVesselState
// maps onto `vessel.state.isEVA` (see `vessel-state.ts`'s VESSEL_TYPE_EVA).
const VESSEL_TYPE_EVA = 7;

// `deriveVesselState` produces NO record until `vessel.orbit` is whole (it
// early-returns `undefined` otherwise), and every derived field, isEVA
// included, hangs off that record. A minimal orbit is emitted alongside
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
  // Slot augments are registered globally, clear so an avatar/badges augment
  // bound in one test can't leak into the "empty slot" assertions of the next.
  clearAugments();
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

    await waitFor(() => expect(visibleText()).toContain("3 / 4 aboard"));
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
    // A partial payload, capacity present, count still undefined. The widget
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
      // Some mods return rich objects instead of plain strings, our guard
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
 * The leading `crew-manifest.avatar` slot, the SDK-independent shell of a
 * per-kerbal avatar/portrait. A per-kerbal square cell left of the name where
 * the bullet renders today; an Uplink can later register an augment that fills
 * it with a live face. Until then (and whenever the augment yields nothing, no
 * Uplink, the avatar source off, kerbal not seated) the cell falls back to the
 * bullet dot, so CrewManifest renders fully with the slot empty. This suite
 * builds ONLY the slot + fallback; no facecam subscription (later task).
 */
describe("CrewManifestComponent, avatar slot", () => {
  it("falls back to the bullet in every row when no avatar augment is bound", async () => {
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
    // Roster renders as before; each row shows the fallback bullet, and no
    // augment content is present.
    expect(screen.getByText("Bill Kerman")).toBeInTheDocument();
    expect(screen.getAllByTestId("crew-avatar-fallback")).toHaveLength(2);
    expect(screen.queryByTestId("crew-avatar")).not.toBeInTheDocument();
  });

  it("composes a bound crew-manifest.avatar augment once per row, carrying each kerbal's identity", async () => {
    // A test Uplink binds the avatar slot and echoes the slot props, proves the
    // slot is exposed, an augment composes into it, and the per-row props carry
    // the right kerbal. `requires` omitted so no Domain presence gate applies.
    registerAugment<"crew-manifest.avatar">({
      id: "test-crew-avatar",
      augments: "crew-manifest.avatar",
      component: ({ crewName, crewIndex }: CrewAvatarContext) => (
        <span data-testid="crew-avatar" data-index={crewIndex}>
          {crewName} face
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

    const avatars = await screen.findAllByTestId("crew-avatar");
    expect(avatars).toHaveLength(3);
    expect(avatars.map((a) => a.textContent)).toEqual([
      "Jebediah Kerman face",
      "Bill Kerman face",
      "Bob Kerman face",
    ]);
    // The augment lands in the right kerbal's row (props identity is correct).
    const billRow = screen.getByText("Bill Kerman").closest("li");
    expect(billRow).not.toBeNull();
    expect(
      within(billRow as HTMLElement).getByTestId("crew-avatar"),
    ).toHaveTextContent("Bill Kerman face");
  });

  it("keeps the roster + avatar cell at both small and large widget sizes", async () => {
    // The avatar cell lives in the roster branch, which renders whenever the
    // widget is at least 4x5. Assert it survives the min-roster size and a large
    // size, the fallback bullet is present per row in both.
    for (const [w, h] of [
      [4, 5],
      [10, 12],
    ] as const) {
      const fixture = newFixture();
      const { unmount } = render(
        <fixture.Provider>
          <CrewManifestComponent config={{}} id="crew" w={w} h={h} />
        </fixture.Provider>,
      );
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
      expect(screen.getByTestId("crew-avatar-fallback")).toBeInTheDocument();
      unmount();
    }
  });
});

/**
 * Kerbalism per-kerbal survival meters. These ride the real
 * `kerbalism.crew`/`kerbalism.lifesupport` Topics (canonical `useTelemetry`,
 * same plumbing as `LifeSupportSystems`) on the SAME stream as `vessel.crew`
 *, no legacy `MockDataSource` anywhere in this file. Absent the
 * KerbalismUplink neither topic ever arrives, `kerbals` stays `undefined`,
 * and the meters simply never render, the roster behaves exactly as the
 * tests above assert.
 */
describe("CrewManifestComponent, survival meters", () => {
  function newSurvivalFixture() {
    return setupStreamFixture({
      carriedChannels: [
        "vessel.crew",
        "vessel.state",
        "kerbalism.crew",
        "kerbalism.lifesupport",
      ],
      pinnedUt: 10,
    });
  }

  it("renders per-kerbal dose + stress meters and a death-clock once toggled on", async () => {
    const fixture = newSurvivalFixture();
    renderCrew(fixture);
    act(() => {
      fixture.emit("vessel.crew", {
        count: 2,
        capacity: 2,
        crew: [{ name: "Jebediah Kerman" }, { name: "Bill Kerman" }],
      });
      // A life-support resource draining → stage-1 death-clock is a real time.
      fixture.emit("kerbalism.lifesupport", {
        food: { amount: 0.35, capacity: 1.35, rate: -0.000036 },
      });
      // Real wire shape: `rules` is an ARRAY of `{name, value, fatalThreshold}`
      // (KerbalismCrewEntry/KerbalismCrewRule), Kerbalism's default profile
      // gives radiation a fatal threshold of 50 and everything else 1, so the
      // widget must normalize each rule by its OWN threshold, not assume 0..1.
      fixture.emit("kerbalism.crew", [
        {
          name: "Jebediah Kerman",
          trait: "Pilot",
          rules: [
            { name: "radiation", value: 30, fatalThreshold: 50 },
            { name: "stress", value: 0.3, fatalThreshold: 1 },
          ],
        },
        {
          name: "Bill Kerman",
          trait: "Engineer",
          rules: [
            { name: "radiation", value: 5, fatalThreshold: 50 },
            { name: "stress", value: 0.05, fatalThreshold: 1 },
          ],
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

    // Jeb's dose is 30/50 = 60% on his meter.
    const jebRow = screen.getByText("Jebediah Kerman").closest("li");
    expect(
      within(jebRow as HTMLElement).getByRole("meter", { name: "Dose" }),
    ).toHaveAttribute("aria-valuenow", "60");

    // Stage-1 death-clock headline while resources drain.
    expect(screen.getAllByText(/to LS depletion/i).length).toBeGreaterThan(0);
  });

  it("shows no meters toggle when no per-kerbal survival data is present", async () => {
    const fixture = newSurvivalFixture();
    renderCrew(fixture);
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
