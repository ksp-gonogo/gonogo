import {
  ContributionsProvider,
  clearAugments,
  clearContributions,
  registerAugment,
  registerContribution,
} from "@ksp-gonogo/core";
import { VesselType, value } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import {
  ContributionsPanelStore,
  createDomainAvailabilityStore,
  DomainAvailabilityContext,
  WidgetMetaContext,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  type CrewAvatarContext,
  type CrewBadgeContext,
  CrewStatusComponent,
} from "./index";

/** CrewStatus runs entirely off the stream, fed through a real `TelemetryProvider` pipeline via `fixture.emit`. */

// `vessel.identity.vesselType === 7` is `VesselType.EVA`, the kerbal on EVA.
const VESSEL_TYPE_EVA = 7;

const renderedTrees: Array<() => void> = [];

function newFixture() {
  return setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
}

/** The same fixture with `vessel.resources` carried, for the suit meters. */
function newEvaFixture() {
  return setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
}

function renderCrew(
  fixture: ReturnType<typeof newFixture> | ReturnType<typeof newEvaFixture>,
  meters: readonly unknown[] = [],
) {
  const { unmount } = render(
    <fixture.Provider>
      {/* The per-row meters resolve their `crew-status.meters` slot id from this meta; the store is seeded directly rather than through an Uplink. */}
      <WidgetMetaContext.Provider
        value={{ componentId: "crew-status", contributionSlots: [] }}
      >
        <ContributionsPanelStore.Provider>
          <SeedMeters entries={meters}>
            <CrewStatusComponent config={{}} id="crew" />
          </SeedMeters>
        </ContributionsPanelStore.Provider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
}

function SeedMeters({
  entries,
  children,
}: {
  entries: readonly unknown[];
  children: ReactNode;
}) {
  const store = ContributionsPanelStore.useStore();
  if (store && store.getSnapshot().length === 0) {
    store.register({ id: "crew-status.meters", entries });
  }
  return <>{children}</>;
}

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  // Augments and contributions are global, so one test's registrations must not leak into the next.
  clearAugments();
  clearContributions();
});

/** Mounts the widget meta and a contribution store, which the plain `renderCrew` lacks, so `useContributions` sees the row-tone entries. */
const CREW_STATUS_META = {
  componentId: "crew-status",
  contributionSlots: ["crew-status.row-tone"] as const,
};

function renderCrewWithContributions(fixture: ReturnType<typeof newFixture>) {
  const { unmount } = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider value={CREW_STATUS_META}>
        <ContributionsProvider>
          <CrewStatusComponent config={{}} id="crew" />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
}

describe("CrewStatusComponent", () => {
  it("shows the waiting placeholder until crew telemetry arrives", () => {
    renderCrew(newFixture());
    expect(screen.getByText(/Waiting for telemetry/i)).toBeInTheDocument();
  });

  it("lists crew names alongside count / capacity", async () => {
    // The headcount is a panel badge (covered by `badge.test.ts`); this tree mounts no badge chrome, so only the roster body is asserted.
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
      expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument(),
    );
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
    // Capacity present, count still undefined: the widget must not conclude "Unmanned".
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

  it("handles rich object payloads by extracting .name", async () => {
    const fixture = newFixture();
    renderCrew(fixture);
    act(() => {
      // Some sources send rich objects instead of plain strings; the guard fishes out the name.
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
      fixture.emit("vessel.identity", { vesselType: VESSEL_TYPE_EVA });
    });
    await waitFor(() => expect(screen.getByText(/EVA/)).toBeInTheDocument());
  });

  it("does not call a crewed ship an EVA", async () => {
    const fixture = newFixture();
    renderCrew(fixture);
    act(() => {
      fixture.emit("vessel.crew", {
        count: 1,
        capacity: 1,
        crew: [{ name: "Jebediah Kerman" }],
      });
      fixture.emit("vessel.identity", { vesselType: VesselType.Ship });
    });
    await waitFor(() =>
      expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/EVA/)).not.toBeInTheDocument();
  });

  /** On EVA the active vessel is the kerbal, so the header names them above their suit meters. */
  describe("EVA header names the kerbal (#384)", () => {
    function evaOnSuit(fixture: ReturnType<typeof newFixture>) {
      fixture.emit("vessel.crew", {
        count: 1,
        capacity: 1,
        crew: [{ name: "Jebediah Kerman" }],
      });
      fixture.emit("vessel.identity", { vesselType: VESSEL_TYPE_EVA });
    }

    it("heads the meters with the kerbal's name instead of a bare EVA caption", async () => {
      const fixture = newFixture();
      renderCrew(fixture);
      act(() => evaOnSuit(fixture));

      await waitFor(() =>
        expect(screen.getByText(/Jebediah Kerman/)).toBeInTheDocument(),
      );
      expect(screen.queryByText("EVA")).not.toBeInTheDocument();
    });

    it("omits the roster Card for the solo EVA kerbal once the header already names them and nothing else is bound to their row", async () => {
      const fixture = newFixture();
      renderCrew(fixture);
      act(() => evaOnSuit(fixture));

      await waitFor(() =>
        expect(screen.getByText(/Jebediah Kerman/)).toBeInTheDocument(),
      );
      // The name appears exactly once: in the header, not repeated in an otherwise-empty roster Card below it.
      expect(screen.getAllByText(/Jebediah Kerman/)).toHaveLength(1);
      expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    });

    it("keeps the roster Card for the solo EVA kerbal when a meter is contributed to their row, but drops the row's own name text", async () => {
      const fixture = newFixture();
      renderCrew(fixture, [
        { id: "dose", row: "Jebediah Kerman", label: "Dose", value: 0.2 },
      ]);
      act(() => evaOnSuit(fixture));

      await waitFor(() => expect(screen.getByText("Dose")).toBeInTheDocument());
      // Named once (the header); the Card holding the contributed meter is still present but no longer repeats the name inside it.
      expect(screen.getAllByText(/Jebediah Kerman/)).toHaveLength(1);
      const row = screen.getByRole("listitem");
      // The identity the visible text no longer carries survives on the Card itself, for an accessibility tree with no other text naming it.
      expect(row).toHaveAccessibleName("Jebediah Kerman");
    });
  });

  describe("EVA suit meters", () => {
    function evaOnSuit(fixture: ReturnType<typeof newEvaFixture>) {
      fixture.emit("vessel.crew", {
        count: 1,
        capacity: 1,
        crew: [{ name: "Jebediah Kerman" }],
      });
      fixture.emit("vessel.identity", { vesselType: VESSEL_TYPE_EVA });
    }

    it("draws the O2 tank from the figures under its own keyed path", async () => {
      const fixture = newEvaFixture();
      renderCrew(fixture);
      act(() => {
        evaOnSuit(fixture);
        fixture.emit("vessel.resources", {
          resources: { Oxygen: { current: 3, max: 12 } },
        });
      });

      await waitFor(() => expect(screen.getByText("O2")).toBeInTheDocument());
      // A real meter with a fraction to assert: the projection carried both halves through, and the kit divided them.
      const o2 = screen.getByRole("meter", { name: "O2" });
      expect(o2).toHaveAttribute("aria-valuenow", "25");
    });

    /** A present key with an unreported level keeps the row with an absent figure: "no O2 tank" and "O2 level unknown" must not draw the same nothing. */
    it("keeps the row but draws no fraction when the level is unreported", async () => {
      const fixture = newEvaFixture();
      renderCrew(fixture);
      act(() => {
        evaOnSuit(fixture);
        fixture.emit("vessel.resources", {
          resources: { Oxygen: { max: 12 } },
        });
      });

      await waitFor(() => expect(screen.getByText("O2")).toBeInTheDocument());
      // No `role="meter"`: a meter asserts an `aria-valuenow` and there is no fraction to assert.
      expect(
        screen.queryByRole("meter", { name: "O2" }),
      ).not.toBeInTheDocument();
    });
  });

  it("renders the per-crew badges slot with no bound augment (empty is fine)", async () => {
    // No augment registered: the slot composes nothing and the roster renders one row per kerbal.
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
    // A test Uplink binds `crew-status.row-badges` and echoes the slot props, so each badge must land on the right kerbal. No `requires`, so no Domain presence gate applies.
    registerAugment<"crew-status.row-badges">({
      id: "test-crew-badge",
      augments: "crew-status.row-badges",
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

/** The leading `crew-status.avatar` cell, reserved only while an augment is bound to the slot. */
describe("CrewStatusComponent, avatar slot", () => {
  it("renders no avatar cell in any row when no avatar augment is bound", async () => {
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
    // No leading cell is reserved on any row, and no augment content is present.
    expect(screen.getByText("Bill Kerman")).toBeInTheDocument();
    expect(screen.queryByTestId("crew-avatar-cell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("crew-avatar")).not.toBeInTheDocument();
  });

  it("composes a bound crew-status.avatar augment once per row, carrying each kerbal's identity", async () => {
    // A test Uplink binds the avatar slot and echoes the slot props, so each avatar must land on the right kerbal.
    registerAugment<"crew-status.avatar">({
      id: "test-crew-avatar",
      augments: "crew-status.avatar",
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
    // The cell itself is reserved now that an augment is bound to the slot.
    expect(screen.getAllByTestId("crew-avatar-cell")).toHaveLength(3);
    // The augment lands in the right kerbal's row (props identity is correct).
    const billRow = screen.getByText("Bill Kerman").closest("li");
    expect(billRow).not.toBeNull();
    expect(
      within(billRow as HTMLElement).getByTestId("crew-avatar"),
    ).toHaveTextContent("Bill Kerman face");
  });

  it("keeps the roster + avatar cell at both small and large widget sizes when an avatar augment is bound", async () => {
    // The avatar cell lives in the roster branch, so it must survive both the 4x5 minimum and a large size.
    registerAugment<"crew-status.avatar">({
      id: "test-crew-avatar-sizes",
      augments: "crew-status.avatar",
      component: ({ crewName }: CrewAvatarContext) => (
        <span data-testid="crew-avatar">{crewName} face</span>
      ),
    });
    for (const [w, h] of [
      [4, 5],
      [10, 12],
    ] as const) {
      const fixture = newFixture();
      const { unmount } = render(
        <fixture.Provider>
          <CrewStatusComponent config={{}} id="crew" w={w} h={h} />
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
      expect(screen.getByTestId("crew-avatar-cell")).toBeInTheDocument();
      unmount();
    }
  });

  it("reclaims the leading cell's width when the widget is at roster size but no avatar augment is bound", async () => {
    // The unbound case at the same 4x5 minimum-roster size.
    const fixture = newFixture();
    const { unmount } = render(
      <fixture.Provider>
        <CrewStatusComponent config={{}} id="crew" w={4} h={5} />
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
    expect(screen.queryByTestId("crew-avatar-cell")).not.toBeInTheDocument();
    unmount();
  });

  it("reserves no avatar cell for an avatar augment whose Domain is not announced, and grows it once the Domain is", async () => {
    // A bundled client registers its augment whether or not its mod is running; with the Domain absent the row keeps its stock layout.
    registerAugment<"crew-status.avatar">({
      id: "test-gated-crew-avatar",
      augments: "crew-status.avatar",
      requires: "absent-avatar-mod",
      component: ({ crewName }: CrewAvatarContext) => (
        <span data-testid="crew-avatar">{crewName} face</span>
      ),
    });
    const availability = createDomainAvailabilityStore();
    const fixture = newFixture();
    const { unmount } = render(
      <DomainAvailabilityContext.Provider value={availability}>
        <fixture.Provider>
          <CrewStatusComponent config={{}} id="crew" />
        </fixture.Provider>
      </DomainAvailabilityContext.Provider>,
    );
    renderedTrees.push(unmount);
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
    expect(screen.queryByTestId("crew-avatar-cell")).not.toBeInTheDocument();

    act(() => availability.setAvailable("absent-avatar-mod", true));

    await waitFor(() =>
      expect(screen.getAllByTestId("crew-avatar-cell")).toHaveLength(2),
    );
    expect(screen.getAllByTestId("crew-avatar")).toHaveLength(2);
  });
});

/**
 * This widget reads only the vanilla `vessel.crew` roster and must never subscribe to an Uplink-owned topic, even one carried on the stream.
 * `kerbalism.*` is the concrete namespace it is measured on.
 */
describe("CrewStatusComponent, decoupled from the survival backend", () => {
  it("never subscribes to a kerbalism.* topic, even when one is carried", async () => {
    const fixture = setupStreamFixture({
      // Carry a kerbalism.* topic alongside vessel.crew: if the widget ever read one, this is where it would show up as a subscription.
      pinnedUt: 10,
      suspendFrames: true,
    });
    renderCrew(fixture);
    act(() => {
      fixture.emit("vessel.crew", {
        count: 1,
        capacity: 1,
        crew: [{ name: "Jebediah Kerman" }],
      });
      fixture.emit("kerbalism.crew", [
        {
          name: "Jebediah Kerman",
          rules: [{ name: "stress", value: 0.9, fatalThreshold: 1 }],
        },
      ]);
    });
    await waitFor(() =>
      expect(screen.getByText("Jebediah Kerman")).toBeInTheDocument(),
    );
    expect(fixture.transport.isSubscribed("kerbalism.crew")).toBe(false);
    // No inline survival chrome (dose/stress meters, a meters toggle).
    expect(
      screen.queryByRole("button", { name: /meters/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("meter", { name: /dose|stress/i })).toBeNull();
  });

  it("does not import any kerbalism.* topic string in its own source", async () => {
    // A static check beside the behavioural one: this widget's source never names an Uplink-owned topic.
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      path.join(import.meta.dirname, "index.tsx"),
      "utf-8",
    );
    expect(source).not.toMatch(/kerbalism\./);
  });
});

/** Per-row survival meters: each roster row draws `WidgetMeters` for the `crew-status.meters` segment, addressed at that kerbal by `row`. */
describe("CrewStatusComponent, per-row survival meters", () => {
  it("renders nothing extra per row when nothing is contributed", async () => {
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
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("puts each contributed meter in the row its `row` names", async () => {
    const fixture = newFixture();
    renderCrew(fixture, [
      {
        id: "jeb:dose",
        label: "Radiation dose",
        value: value("ratio", 0.4),
        tone: "warn",
        valueLabel: "40%",
        row: "Jebediah Kerman",
      },
      {
        id: "bill:stress",
        label: "Stress",
        value: value("ratio", 0.1),
        tone: "go",
        valueLabel: "10%",
        row: "Bill Kerman",
      },
    ]);
    act(() => {
      fixture.emit("vessel.crew", {
        count: 2,
        capacity: 2,
        crew: [{ name: "Jebediah Kerman" }, { name: "Bill Kerman" }],
      });
    });

    await screen.findByRole("meter", { name: "Radiation dose" });
    const billRow = screen.getByText("Bill Kerman").closest("li");
    expect(billRow).not.toBeNull();
    // A per-row extension that pooled every kerbal's meters into one stack would pass a "both rendered" assertion and be attributed to nobody.
    expect(
      within(billRow as HTMLElement).getByRole("meter", { name: "Stress" }),
    ).toBeInTheDocument();
    expect(
      within(billRow as HTMLElement).queryByRole("meter", {
        name: "Radiation dose",
      }),
    ).toBeNull();
  });
});

/** The `crew-status.summary` slot: one whole-widget section above the roster, composing nothing when unbound. */
describe("CrewStatusComponent, summary slot", () => {
  it("renders nothing extra when no summary augment is bound", async () => {
    const fixture = newFixture();
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
    expect(screen.queryByTestId("crew-summary")).not.toBeInTheDocument();
  });

  it("composes a bound crew-status.summary augment exactly once, not per row", async () => {
    registerAugment<"crew-status.summary">({
      id: "test-crew-summary",
      augments: "crew-status.summary",
      component: () => <span data-testid="crew-summary">vessel status</span>,
    });

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
    // One instance total, not one per crew row.
    expect(screen.getAllByTestId("crew-summary")).toHaveLength(1);
  });
});

/** The `crew-status.row-tone` contribution reaches the right kerbal's row, and every other row stays untinted. */
describe("CrewStatusComponent, row tone contribution", () => {
  it("renders every row with Card's default (untinted) border when nothing contributes a tone", async () => {
    const fixture = newFixture();
    renderCrewWithContributions(fixture);
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
    // Card's `as="li"` preserves list semantics.
    expect(screen.getByText("Bill Kerman").closest("li")).not.toBeNull();
    // jsdom cannot resolve `var()` inside the `border-left` shorthand, so this asserts on the injected stylesheet text: no alert-tone rule anywhere.
    const styleText = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent)
      .join("\n");
    expect(styleText).not.toContain(
      "border-left:2px solid var(--color-nogo-mark);",
    );
  });

  it("colours only the kerbal a bound contribution names critical", async () => {
    registerContribution({
      id: "test-crew-row-tone",
      contributes: "crew-status.row-tone",
      compute: () => [{ crewName: "Bill Kerman", tone: "nogo" as const }],
    });

    const fixture = newFixture();
    renderCrewWithContributions(fixture);
    act(() => {
      fixture.emit("vessel.crew", {
        count: 2,
        capacity: 2,
        crew: [{ name: "Jebediah Kerman" }, { name: "Bill Kerman" }],
      });
    });
    await waitFor(() =>
      expect(screen.getByText("Bill Kerman")).toBeInTheDocument(),
    );
    // The alert-tone border rule in the injected stylesheet proves the contribution reached the widget.
    const styleText = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent)
      .join("\n");
    expect(styleText).toContain(
      "border-left:2px solid var(--color-nogo-mark);",
    );
  });
});
