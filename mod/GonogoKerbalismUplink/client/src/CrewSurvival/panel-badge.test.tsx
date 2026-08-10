import {
  ContributionsProvider,
  useWidgetBadges,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { clearProcessorRuntime } from "@ksp-gonogo/sitrep-client";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { Panel, PanelBadgesProvider } from "@ksp-gonogo/ui-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
// Importing the real module runs its module-load
// `KERBALISM.registerContribution(...)` (the panel badge under test).
import "./badge";

/**
 * End-to-end proof that the CrewStatus panel badge (`badge.ts`) actually
 * reaches the header, not just that `survivalBadges` returns the right
 * object (that is `badge.test.ts`'s job). This wires the same three layers
 * the real app's `GridItemContent` does (`WidgetMetaContext` ->
 * `ContributionsProvider` -> `useWidgetBadges` -> `PanelBadgesProvider` ->
 * `Panel`), so a break anywhere in that chain, not only inside
 * `survivalBadges` itself, shows up here.
 *
 * The `render-widget` probe harness cannot stand in for this: it
 * deliberately never mounts `PanelBadgesProvider` (see
 * `probe-entry.tsx`'s own comment), so no widget's panel badge, this one
 * included, ever appears in a `local_docs/renders/**` PNG.
 */

const CARRIED = ["vessel.crew", "kerbalism.crew", "kerbalism.available"];

function CrewStatusPanelHeader() {
  const badges = useWidgetBadges();
  return (
    <PanelBadgesProvider badges={badges}>
      <Panel panelTitle="CREW">crew rows</Panel>
    </PanelBadgesProvider>
  );
}

function newFixture() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  for (const topic of CARRIED) fixture.client.subscribe(topic, () => {});
  return fixture;
}

function renderPanel(fixture: ReturnType<typeof newFixture>) {
  return render(
    <fixture.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId: "crew-status", contributionSlots: [] }}
      >
        <ContributionsProvider>
          <CrewStatusPanelHeader />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
}

function emit(
  fixture: ReturnType<typeof newFixture>,
  crew: unknown,
  kerbals: unknown,
) {
  act(() => {
    fixture.emit("vessel.crew", crew);
    fixture.emit("kerbalism.crew", kerbals);
    // The contribution's `requires: "kerbalism"` gate reads this directly
    // off the client (`contributionsRuntime.tsx`), unlike an augment's own
    // `RequiresGuard`; a raw-component augment test can skip it, this one
    // cannot.
    fixture.emit("kerbalism.available", true);
  });
}

beforeEach(() => {
  // Same module-global Processor cache reset `index.test.tsx` performs;
  // see that file's own comment for why it matters across fixtures.
  clearProcessorRuntime();
});

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  unmount = undefined;
});

describe("CrewStatus panel badge (crew-survival-badge contribution)", () => {
  it("shows no badge in the header while the whole crew is nominal", async () => {
    const fixture = newFixture();
    const result = renderPanel(fixture);
    unmount = result.unmount;
    emit(
      fixture,
      {
        count: 2,
        capacity: 2,
        crew: [
          { name: "Jebediah Kerman", trait: "Pilot" },
          { name: "Bill Kerman", trait: "Engineer" },
        ],
      },
      [
        {
          name: "Jebediah Kerman",
          rules: [{ name: "stress", value: 0.1, fatalThreshold: 1 }],
        },
      ],
    );
    await screen.findByText("CREW");
    expect(screen.queryByText(/critical/i)).not.toBeInTheDocument();
  });

  it("flags a single critical kerbal as vessel-level, not by name", async () => {
    const fixture = newFixture();
    const result = renderPanel(fixture);
    unmount = result.unmount;
    emit(
      fixture,
      {
        count: 1,
        capacity: 1,
        crew: [{ name: "Jebediah Kerman", trait: "Pilot" }],
      },
      [{ name: "Jebediah Kerman", deathClockSec: 120 }],
    );
    expect(await screen.findByText("Crew critical")).toBeInTheDocument();
    expect(screen.queryByText(/Jebediah/)).not.toBeInTheDocument();
  });

  it("counts multiple critical kerbals", async () => {
    const fixture = newFixture();
    const result = renderPanel(fixture);
    unmount = result.unmount;
    emit(
      fixture,
      {
        count: 2,
        capacity: 2,
        crew: [
          { name: "Jebediah Kerman", trait: "Pilot" },
          { name: "Bill Kerman", trait: "Engineer" },
        ],
      },
      [
        { name: "Jebediah Kerman", deathClockSec: 120 },
        { name: "Bill Kerman", deathClockSec: 90 },
      ],
    );
    expect(await screen.findByText("2 crew critical")).toBeInTheDocument();
  });
});
