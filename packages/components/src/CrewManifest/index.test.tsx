import { clearAugments, registerAugment } from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  type CrewAvatarContext,
  type CrewBadgeContext,
  CrewManifestComponent,
  type CrewSurvivalSlotContext,
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
    // The "N / M aboard" headcount no longer renders as body text here, it
    // moved to the info-tone `crew-manifest.badges` panel-badge contribution
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
 * per-kerbal avatar/portrait. A per-kerbal square cell left of the name; an
 * Uplink can register an augment that fills it with a live face. The cell is
 * only reserved while at least one augment is actually bound to the slot
 * (operator feedback: a same-size cell showing nothing but a decorative
 * fallback dot was wasted width on every row, and the dot never signalled
 * anything). With no avatar augment bound, no cell renders at all and the
 * row's leading space goes back to the name. This suite builds ONLY the slot
 * + its presence gating; no facecam subscription (later task).
 */
describe("CrewManifestComponent, avatar slot", () => {
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
    registerAugment<"crew-manifest.avatar">({
      id: "test-crew-avatar-sizes",
      augments: "crew-manifest.avatar",
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
        <CrewManifestComponent config={{}} id="crew" w={4} h={5} />
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
 * Per-kerbal survival (death clock, worst rule, degen) is a Kerbalism
 * concept, not a vanilla one: it moved wholesale out of this widget into the
 * Kerbalism Uplink's own `crew-manifest-survival` augment
 * (mod/GonogoKerbalismUplink/client/src/CrewSurvival), which fills the
 * generic `crew-manifest.survival` slot this widget exposes. This widget
 * itself reads ONLY the vanilla `vessel.crew` roster now, no `kerbalism.*`
 * topic anywhere in index.tsx (grep-verified below), so it must render
 * identically with or without a KerbalismUplink present, and it must NEVER
 * subscribe to a `kerbalism.*` topic even when one is carried on the stream.
 */
describe("CrewManifestComponent, de-contaminated from Kerbalism", () => {
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
    // whole point of the de-contamination is that this file's source never
    // names a Kerbalism topic. Reads the source file's own text directly.
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
 * The `crew-manifest.survival` per-row slot: the generic home a Kerbalism (or
 * any other) Uplink fills with per-kerbal survival state. Same per-row
 * keying as `.badges`/`.avatar` above; this suite builds only the slot +
 * empty-composes-to-nothing contract, matching those siblings' own tests.
 */
describe("CrewManifestComponent, survival slot", () => {
  it("renders nothing extra per row when no survival augment is bound", async () => {
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
    expect(screen.queryByTestId("crew-survival")).not.toBeInTheDocument();
  });

  it("composes a bound crew-manifest.survival augment once per row, carrying each kerbal's identity", async () => {
    registerAugment<"crew-manifest.survival">({
      id: "test-crew-survival",
      augments: "crew-manifest.survival",
      component: ({ crewName, crewIndex }: CrewSurvivalSlotContext) => (
        <span data-testid="crew-survival" data-index={crewIndex}>
          {crewName} survival
        </span>
      ),
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

    const rows = await screen.findAllByTestId("crew-survival");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.textContent)).toEqual([
      "Jebediah Kerman survival",
      "Bill Kerman survival",
    ]);
    const billRow = screen.getByText("Bill Kerman").closest("li");
    expect(billRow).not.toBeNull();
    expect(
      within(billRow as HTMLElement).getByTestId("crew-survival"),
    ).toHaveTextContent("Bill Kerman survival");
  });
});
