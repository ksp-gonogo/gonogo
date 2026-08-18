import { act, render, screen, within } from "@ksp-gonogo/sitrep-sdk/testing";
import {
  clearProcessorRuntime,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
// Importing the real module runs its module-load registerAugment(...).
import { CrewSurvivalAugment, CrewSurvivalBadgeAugment } from "./index";

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

function renderBadgeAugment(
  fixture: ReturnType<typeof newFixture>,
  crewName: string,
  crewIndex: number,
) {
  const result = render(
    <fixture.Provider>
      <CrewSurvivalBadgeAugment crewName={crewName} crewIndex={crewIndex} />
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

  it("renders a single rule as a meter, no badge alongside it", async () => {
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

    // "radiation" maps to the clearer "Radiation dose" label (see
    // ruleLabel's own doc comment).
    const meter = await screen.findByRole("meter", { name: "Radiation dose" });
    expect(meter).toHaveAttribute("aria-valuenow", "90");
    expect(meter).toHaveAttribute("aria-valuetext", "90 %");
    // The `.survival` slot is meter-only now: no badge restating the same
    // rule name/percentage underneath it (that used to render literally as
    // "Radiation dose 90 %" text of its own, the exact redundant-restatement
    // bug this augment used to have; the consequence badge moved to
    // CrewSurvivalBadgeAugment, tested separately below).
    expect(screen.queryByText(/critical/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/radiation dose 90 %/i)).not.toBeInTheDocument();
  });

  it("renders every rule as its own meter, not just the worst", async () => {
    const fixture = newFixture();
    renderAugment(fixture, "Jebediah Kerman", 0);
    emit(fixture, CREW, [
      {
        name: "Jebediah Kerman",
        rules: [
          { name: "radiation", value: 45, fatalThreshold: 50 },
          { name: "stress", value: 0.2, fatalThreshold: 1 },
        ],
      },
    ]);

    // Both meters present, worst (radiation dose, 90%) shown before stress
    // (20%): rules are sorted worst-first (processor.ts).
    const doseMeter = await screen.findByRole("meter", {
      name: "Radiation dose",
    });
    const stressMeter = await screen.findByRole("meter", { name: "Stress" });
    expect(doseMeter).toHaveAttribute("aria-valuenow", "90");
    expect(stressMeter).toHaveAttribute("aria-valuenow", "20");
    const meters = screen.getAllByRole("meter");
    expect(meters.indexOf(doseMeter)).toBeLessThan(meters.indexOf(stressMeter));
  });

  it("renders every rule unconditionally, no overflow disclosure", async () => {
    const fixture = newFixture();
    renderAugment(fixture, "Jebediah Kerman", 0);
    emit(fixture, CREW, [
      {
        name: "Jebediah Kerman",
        rules: [
          { name: "radiation", value: 45, fatalThreshold: 50 },
          { name: "stress", value: 0.6, fatalThreshold: 1 },
          { name: "co2 poisoning", value: 0.3, fatalThreshold: 1 },
          { name: "eating", value: 0.2, fatalThreshold: 1 },
          { name: "drinking", value: 0.15, fatalThreshold: 1 },
          { name: "breathing", value: 0.1, fatalThreshold: 1 },
          { name: "climatization", value: 0.05, fatalThreshold: 1 },
        ],
      },
    ]);

    // Every rule renders directly, unconditionally: no "Show N more" trigger
    // and nothing collapsed behind it.
    await screen.findByRole("meter", { name: "Radiation dose" });
    await screen.findByRole("meter", { name: "Stress" });
    expect(
      await screen.findByRole("meter", { name: "Co2 poisoning" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("meter", { name: "Eating" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("meter", { name: "Drinking" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("meter", { name: "Breathing" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("meter", { name: "Climatization" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /show.*more/i }),
    ).not.toBeInTheDocument();
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

    await within(jeb.container).findByRole("meter", { name: "Radiation dose" });
    expect(
      within(bill.container).queryByLabelText("survival meters"),
    ).not.toBeInTheDocument();
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
    await screen.findByRole("meter", { name: "Radiation dose" });

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("CrewSurvivalBadgeAugment", () => {
  it("shows no badge for a nominal kerbal", async () => {
    const fixture = newFixture();
    renderAugment(fixture, "Jebediah Kerman", 0);
    renderBadgeAugment(fixture, "Jebediah Kerman", 0);
    emit(fixture, CREW, [
      {
        name: "Jebediah Kerman",
        rules: [{ name: "stress", value: 0.1, fatalThreshold: 1 }],
      },
    ]);
    // The meter (from `.survival`) is the proof the Processor evaluated;
    // the badge's absence right beside it is the meaningful negative.
    await screen.findByRole("meter", { name: "Stress" });
    expect(screen.queryByText(/critical/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/to fatal/i)).not.toBeInTheDocument();
  });

  it("shows no badge for a merely-elevated (warn-tier) kerbal", async () => {
    const fixture = newFixture();
    renderAugment(fixture, "Jebediah Kerman", 0);
    renderBadgeAugment(fixture, "Jebediah Kerman", 0);
    emit(fixture, CREW, [
      {
        name: "Jebediah Kerman",
        rules: [{ name: "stress", value: 0.6, fatalThreshold: 1 }],
      },
    ]);
    // The meter (from `.survival`) is the proof the Processor evaluated;
    // the badge's absence right beside it is the meaningful negative, same
    // "prove data arrived, then assert a negative" pattern as the roster
    // test above.
    await screen.findByRole("meter", { name: "Stress" });
    expect(screen.queryByText(/critical/i)).not.toBeInTheDocument();
  });

  it("flags a rule past its critical fraction as a consequence, never a restated percentage", async () => {
    const fixture = newFixture();
    renderBadgeAugment(fixture, "Jebediah Kerman", 0);
    emit(fixture, CREW, [
      {
        name: "Jebediah Kerman",
        rules: [{ name: "radiation", value: 45, fatalThreshold: 50 }],
      },
    ]);
    expect(
      await screen.findByText("Radiation dose critical"),
    ).toBeInTheDocument();
    // The bug this augment fixes: a badge that just restates the meter's
    // own number ("radiation dose 90%") instead of the consequence.
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/90/)).not.toBeInTheDocument();
  });

  it("flags an imminent death clock as a countdown to fatal", async () => {
    const fixture = newFixture();
    renderBadgeAugment(fixture, "Jebediah Kerman", 0);
    emit(fixture, CREW, [{ name: "Jebediah Kerman", deathClockUt: 130 }]);
    expect(await screen.findByText(/to fatal/i)).toBeInTheDocument();
  });

  it("has no axe violations when flagging a critical kerbal", async () => {
    const fixture = newFixture();
    const { container } = renderBadgeAugment(fixture, "Jebediah Kerman", 0);
    emit(fixture, CREW, [
      {
        name: "Jebediah Kerman",
        rules: [{ name: "radiation", value: 45, fatalThreshold: 50 }],
      },
    ]);
    await screen.findByText("Radiation dose critical");

    expect(await axe(container)).toHaveNoViolations();
  });
});
