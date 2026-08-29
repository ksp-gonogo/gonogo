import {
  ContributionsProvider,
  clearAugments,
  clearContributions,
  registerAugment,
  registerContribution,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { ContributionsPanelStore, WidgetMetaContext } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  type CrewAvatarContext,
  type CrewBadgeContext,
  CrewStatusComponent,
} from "./index";

/**
 * CrewStatus runs entirely off the stream: `vessel.crew`
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

function renderCrew(
  fixture: ReturnType<typeof newFixture>,
  meters: readonly unknown[] = [],
) {
  const { unmount } = render(
    <fixture.Provider>
      {/* The identity the dashboard supplies, plus a seeded contribution store:
          the per-row survival meters arrive through the framework's universal
          `crew-status.meters` segment, which resolves its slot id from this
          meta. Seeded directly rather than through the aggregation, which would
          mean standing up an Uplink to test a roster. */}
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
  // Slot augments are registered globally, clear so an avatar/badges augment
  // bound in one test can't leak into the "empty slot" assertions of the next.
  clearAugments();
  // Same reasoning for contributions (crew-status.row-tone): a tone
  // registered in one test must not leak into the next.
  clearContributions();
});

/** `WidgetMetaContext` + `ContributionsProvider` mounted explicitly (mirrors
 *  ShipMap's own `contributions.test.tsx`): `renderCrew` alone has no
 *  contribution store at all, `useContributions` silently returns empty,
 *  same as a bare widget with no dashboard around it. Only the row-tone
 *  tests need this; every other describe block above renders through the
 *  plain `renderCrew`. */
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
    // The "N / M aboard" headcount no longer renders as body text here, it
    // moved to the info-tone `crew-status.badges` panel-badge contribution
    // (`./badge.ts`, `crewAboardBadge`'s own unit tests cover the label
    // itself). This render tree mounts no `ContributionsProvider`/`Panel`
    // badge chrome at all, so what's left to prove here is the roster body.
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

  it("handles rich object payloads by extracting .name", async () => {
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
    // A test Uplink binds `crew-status.row-badges` and echoes the slot props back.
    // Proves (a) the slot is exposed, (b) an augment composes into it, and (c)
    // the per-row props carry the right kerbal so the badge lands on the right
    // one. `requires` is omitted so no Domain presence gate applies.
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

/**
 * The leading `crew-status.avatar` slot, the SDK-independent shell of a
 * per-kerbal avatar/portrait. A per-kerbal square cell left of the name; an
 * Uplink can register an augment that fills it with a live face. The cell is
 * only reserved while at least one augment is actually bound to the slot
 * (operator feedback: a same-size cell showing nothing but a decorative
 * fallback dot was wasted width on every row, and the dot never signalled
 * anything). With no avatar augment bound, no cell renders at all and the
 * row's leading space goes back to the name. This suite builds ONLY the slot
 * + its presence gating; no facecam subscription (later task).
 */
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
    // Roster renders as before; no leading cell is reserved on any row, and
    // no augment content is present.
    expect(screen.getByText("Bill Kerman")).toBeInTheDocument();
    expect(screen.queryByTestId("crew-avatar-cell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("crew-avatar")).not.toBeInTheDocument();
  });

  it("composes a bound crew-status.avatar augment once per row, carrying each kerbal's identity", async () => {
    // A test Uplink binds the avatar slot and echoes the slot props, proves the
    // slot is exposed, an augment composes into it, and the per-row props carry
    // the right kerbal. `requires` omitted so no Domain presence gate applies.
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
    // The avatar cell lives in the roster branch, which renders whenever the
    // widget is at least 4x5. Assert it survives the min-roster size and a
    // large size, once an Uplink actually binds the slot.
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
    // Companion to the "no cell at all" assertion above, exercised at the
    // same 4x5 minimum-roster size the previous test uses, proving the
    // reclaimed-space behaviour holds across sizes too, not just the default.
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
});

/**
 * Per-kerbal survival (death clock, worst rule, degen) is a life-support
 * concept, not a vanilla one: it moved wholesale out of this widget into an
 * Uplink's own `crew-status-survival` augment, which fills the generic
 * `crew-status.survival` slot this widget exposes. This widget itself reads
 * ONLY the vanilla `vessel.crew` roster now, no Uplink-owned topic anywhere
 * in index.tsx, so it must render identically whichever backend is elected,
 * and it must NEVER subscribe to one even when it is carried on the stream.
 *
 * The two checks below pin that against one concrete namespace, `kerbalism.*`,
 * because an assertion needs a real topic to probe: the rule is the general
 * one above, this is the instance it is measured on.
 */
describe("CrewStatusComponent, decoupled from the survival backend", () => {
  it("never subscribes to a kerbalism.* topic, even when one is carried", async () => {
    const fixture = setupStreamFixture({
      // Carry a kerbalism.* topic alongside vessel.crew: if the widget ever
      // read one, this is where it would show up as a subscription.
      carriedChannels: ["vessel.crew", "kerbalism.crew"],
      pinnedUt: 10,
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
    // No leftover survival chrome (dose/stress meters, a meters toggle):
    // that UI moved to the augment slot below, not rendered inline anymore.
    expect(
      screen.queryByRole("button", { name: /meters/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("meter", { name: /dose|stress/i })).toBeNull();
  });

  it("does not import any kerbalism.* topic string in its own source", async () => {
    // Belt-and-braces static check alongside the behavioural one above: the
    // whole point of the decoupling is that this file's source never names an
    // Uplink-owned topic. Reads the source file's own text directly.
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      path.join(import.meta.dirname, "index.tsx"),
      "utf-8",
    );
    expect(source).not.toMatch(/kerbalism\./);
  });
});

/**
 * Per-row survival meters. Not a widget-authored slot any more: each roster row
 * draws ui-kit's `WidgetMeters` for the framework-universal `crew-status.meters`
 * CONTRIBUTION segment, addressed at that kerbal by the entry's own `row`.
 *
 * The old `crew-status.survival` augment slot was filled by a component whose
 * entire render was a stack of the kit's own `Meter`, i.e. zero pixels this
 * widget did not already own; as data the host can count, order and place them.
 */
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
        value: 0.4,
        tone: "warn",
        valueLabel: "40%",
        row: "Jebediah Kerman",
      },
      {
        id: "bill:stress",
        label: "Stress",
        value: 0.1,
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
    // Bill's row has HIS meter and not Jebediah's: a per-row extension that
    // pooled every kerbal's meters into one stack would pass a "both rendered"
    // assertion and be attributed to nobody.
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

/**
 * The `crew-status.summary` slot: a WHOLE-WIDGET section, rendered once
 * above the roster rather than once per row, for a status that affects the
 * whole crew together (e.g. a vessel-wide radiation reading). Same
 * empty-composes-to-nothing contract as the other slots, just one instance
 * instead of one per kerbal.
 */
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

/**
 * The `crew-status.row-tone` slot: a CONTRIBUTION (pure data, host renders
 * its own `Card` chrome), not an AugmentSlot, see that slot's own doc
 * comment in `index.tsx`. Proves the self-contribution unify end to end,
 * same shape as ShipMap's `contributions.test.tsx`: a test-registered
 * contribution reaches the right kerbal's row, and every other row stays
 * untinted.
 */
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
    // Each row is still a real roster `<li>`, Card's `as="li"` preserves list
    // semantics (unchanged from the bare `<li>` this replaced).
    expect(screen.getByText("Bill Kerman").closest("li")).not.toBeNull();
    // No contribution registered at all: Card's alert-tone accent rule
    // (jsdom can't validate an unresolved `var()` inside the `border-left`
    // shorthand, `toHaveStyle` can't see it, so this asserts on the
    // styled-components injected stylesheet text directly, the same
    // workaround Card's own test suite uses) must not appear anywhere.
    const styleText = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent)
      .join("\n");
    expect(styleText).not.toContain(
      "border-left:2px solid var(--color-status-nogo-bg);",
    );
  });

  it("colours only the kerbal a bound contribution names critical", async () => {
    registerContribution<"crew-status.row-tone">({
      id: "test-crew-row-tone",
      contributes: "crew-status.row-tone",
      compute: () => [{ crewName: "Bill Kerman", severity: "critical" }],
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
    // Proves the contribution actually reached the widget: Card's alert-tone
    // border rule shows up in the injected stylesheet (same technique
    // Card.test.tsx uses for the same jsdom var()-in-shorthand gap).
    const styleText = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent)
      .join("\n");
    expect(styleText).toContain(
      "border-left:2px solid var(--color-status-nogo-bg);",
    );
  });
});
