import { clearProcessorRuntime } from "@ksp-gonogo/sitrep-client";
import { act, render, screen, within } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { setupStreamFixture } from "../test/setupStreamFixture";
// Importing the real module runs its module-load registerAugment(...).
import { CrewSurvivalAugment } from "./index";

const CARRIED = ["vessel.crew", "kerbalism.crew"];

const renderedTrees: Array<() => void> = [];

function newFixture() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: 10,
  });
  // `useProcessor`'s dependency resolution reads straight off the
  // TimelineStore, it does not itself call `client.subscribe` the way
  // `useTelemetry`/`useStream` do (see ShipSystems/index.test.tsx's own doc
  // comment on this same gap). A dummy subscribe per topic flips
  // `StubTransport.emit`'s subscription gate the way a companion widget
  // reading the same topic would in production.
  for (const topic of CARRIED) fixture.client.subscribe(topic, () => {});
  return fixture;
}

function renderAugment(
  fixture: ReturnType<typeof newFixture>,
  crewName: string,
  crewIndex: number,
) {
  const result = render(
    <fixture.Provider>
      <CrewSurvivalAugment crewName={crewName} crewIndex={crewIndex} />
    </fixture.Provider>,
  );
  renderedTrees.push(result.unmount);
  return result;
}

function emit(
  fixture: ReturnType<typeof newFixture>,
  crew: unknown,
  kerbals: unknown,
) {
  act(() => {
    fixture.emit("vessel.crew", crew);
    fixture.emit("kerbalism.crew", kerbals);
  });
}

beforeEach(() => {
  // The Processor evaluator's runtime cache (evaluated value + frame
  // generation) is a MODULE-GLOBAL singleton keyed by Processor id, shared
  // across every fixture in this file. Each test below mounts its own fresh
  // TelemetryProvider/TimelineStore whose frame-generation counter restarts
  // at 0, so without a reset a later test's frame can coincide with an
  // earlier test's `lastFrameGeneration` and silently keep serving that
  // earlier test's stale computed value forever (see clearProcessorRuntime's
  // own doc comment in sitrep-client for the full mechanism). Resetting
  // before each test is the same isolation sitrep-client's own Processor
  // tests use.
  clearProcessorRuntime();
});

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
});

const CREW = {
  count: 2,
  capacity: 2,
  crew: [
    { name: "Jebediah Kerman", trait: "Pilot" },
    { name: "Bill Kerman", trait: "Engineer" },
  ],
};

describe("CrewSurvivalAugment", () => {
  it("renders nothing before any survival data has arrived", () => {
    const fixture = newFixture();
    renderAugment(fixture, "Jebediah Kerman", 0);
    // No emit at all: useProcessor(CREW_SURVIVAL) has nothing to derive from
    // yet, the augment must render nothing rather than a "stable" default
    // for a kerbal it knows nothing about.
    expect(screen.queryByLabelText("survival meters")).not.toBeInTheDocument();
  });

  it("renders the worst rule as a meter and the death-clock badge for a critical kerbal", async () => {
    const fixture = newFixture();
    renderAugment(fixture, "Jebediah Kerman", 0);
    emit(fixture, CREW, [
      {
        name: "Jebediah Kerman",
        rules: [{ name: "radiation", value: 45, fatalThreshold: 50 }],
      },
      {
        name: "Bill Kerman",
        rules: [{ name: "stress", value: 0.05, fatalThreshold: 1 }],
      },
    ]);

    const meter = await screen.findByRole("meter", { name: "Radiation" });
    expect(meter).toHaveAttribute("aria-valuenow", "90");
    expect(screen.getByText(/radiation 90 %/i)).toBeInTheDocument();
  });

  it("renders nothing for a kerbal Kerbalism reports no rules or clock for", async () => {
    // Renders BOTH rows in one test: Jebediah's meter appearing is the proof
    // the Processor actually re-evaluated for THIS test's data (not a stale
    // value from a previous test), so Bill's absence right beside it is a
    // meaningful negative, not just "nothing has happened yet".
    const fixture = newFixture();
    const jeb = render(
      <fixture.Provider>
        <CrewSurvivalAugment crewName="Jebediah Kerman" crewIndex={0} />
      </fixture.Provider>,
    );
    const bill = render(
      <fixture.Provider>
        <CrewSurvivalAugment crewName="Bill Kerman" crewIndex={1} />
      </fixture.Provider>,
    );
    renderedTrees.push(jeb.unmount, bill.unmount);
    emit(fixture, CREW, [
      {
        name: "Jebediah Kerman",
        rules: [{ name: "radiation", value: 45, fatalThreshold: 50 }],
      },
      // Bill has no entry at all.
    ]);

    await within(jeb.container).findByRole("meter", { name: "Radiation" });
    expect(
      within(bill.container).queryByLabelText("survival meters"),
    ).not.toBeInTheDocument();
  });

  it("shows a death-clock countdown badge when the wire reports one", async () => {
    const fixture = newFixture();
    renderAugment(fixture, "Jebediah Kerman", 0);
    emit(fixture, CREW, [{ name: "Jebediah Kerman", deathClockSec: 120 }]);
    expect(await screen.findByText(/to fatal/i)).toBeInTheDocument();
  });

  it("falls back to a name search when crewIndex has drifted from the Processor's own order", async () => {
    const fixture = newFixture();
    // crewIndex 5 does not exist in the roster; the augment must still find
    // Bill Kerman by name.
    renderAugment(fixture, "Bill Kerman", 5);
    emit(fixture, CREW, [
      {
        name: "Bill Kerman",
        rules: [{ name: "stress", value: 0.9, fatalThreshold: 1 }],
      },
    ]);
    expect(
      await screen.findByRole("meter", { name: "Stress" }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const fixture = newFixture();
    const { container } = renderAugment(fixture, "Jebediah Kerman", 0);
    emit(fixture, CREW, [
      {
        name: "Jebediah Kerman",
        rules: [{ name: "radiation", value: 45, fatalThreshold: 50 }],
      },
    ]);
    await screen.findByRole("meter", { name: "Radiation" });

    expect(await axe(container)).toHaveNoViolations();
  });
});
