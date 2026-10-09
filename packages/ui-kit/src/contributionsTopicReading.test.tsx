import {
  type TopicCurrency,
  topicReading,
  value,
  withoutReckoning,
} from "@ksp-gonogo/sitrep-sdk";
import {
  clearContributions,
  registerContribution,
} from "@ksp-gonogo/sitrep-sdk/spine";
import {
  act,
  render,
  screen,
  setupStreamFixture,
  stopArriving,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { useContributionsBySlotId } from "./contributionsRead";
import {
  ContributionsProvider,
  contributionReading,
} from "./contributionsRuntime";
import { WidgetMetaContext } from "./WidgetMetaContext";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface ContributionRegistry {
    "topic-reading-probe.rows": { entry: { label: string } };
  }
}

const SLOT = "topic-reading-probe.rows";

function Probe() {
  const entries = useContributionsBySlotId(SLOT) as readonly {
    label: string;
  }[];
  return <output>{entries.map((e) => e.label).join("|")}</output>;
}

function mount() {
  const stream = setupStreamFixture();
  render(
    <stream.Provider>
      <WidgetMetaContext.Provider
        value={{
          componentId: "topic-reading-probe",
          contributionSlots: [SLOT],
        }}
      >
        <ContributionsProvider>
          <Probe />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>
    </stream.Provider>,
  );
  return stream;
}

// beforeEach, never afterEach: clearing while the previous test's tree is still mounted notifies SlotAggregator's subscription outside act()
beforeEach(() => {
  clearContributions();
});

describe("a contribution's Topic dep", () => {
  it("receives the Topic's reading, so a value whose updates stopped arrives held", () => {
    registerContribution({
      id: "reading",
      contributes: SLOT,
      deps: ["crash.hasRecent"],
      compute: (topics) => {
        const reading = topics["crash.hasRecent"];
        return [
          {
            label:
              reading.state === "observed" || reading.state === "held"
                ? `${reading.state}:${String(reading.value.recent)}`
                : reading.state,
          },
        ];
      },
    });
    const stream = mount();
    expect(screen.getByRole("status")).toHaveTextContent("pending");

    act(() => {
      stream.emit("crash.hasRecent", { recent: true });
      stream.store.beginFrame();
    });
    expect(screen.getByRole("status")).toHaveTextContent("observed:true");

    act(() => stopArriving(stream));
    expect(screen.getByRole("status")).toHaveTextContent("held:true");
  });

  it("receives a never-arrived reading for each declared Topic when no store is mounted", () => {
    registerContribution({
      id: "no-store",
      contributes: SLOT,
      deps: ["crash.hasRecent", "vessel.crew"],
      compute: (topics) => [
        {
          label: `${topics["crash.hasRecent"].state}|${topics["vessel.crew"].state}`,
        },
      ],
    });
    render(
      <WidgetMetaContext.Provider
        value={{
          componentId: "topic-reading-probe",
          contributionSlots: [SLOT],
        }}
      >
        <ContributionsProvider>
          <Probe />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("pending|pending");
  });
});

describe("contributionReading", () => {
  const observed = (recent: boolean, at: number) =>
    topicReading({
      state: "observed",
      value: { recent },
      atUt: value("ut", at),
      reckoning: { status: "none" },
    }) as TopicCurrency<unknown, { readonly status: "none" }>;
  const PAYLOAD = { recent: true };

  it("keeps the previous reading when only its model moved, so a modelled Topic does not re-run compute every frame", () => {
    const first = withoutReckoning(
      topicReading({
        state: "observed",
        value: PAYLOAD,
        atUt: value("ut", 10),
        reckoning: { status: "none" },
      }),
    ) as TopicCurrency<unknown, { readonly status: "none" }>;
    const second = withoutReckoning(
      topicReading({
        state: "observed",
        value: PAYLOAD,
        atUt: value("ut", 10),
        reckoning: { status: "none" },
      }),
    ) as TopicCurrency<unknown, { readonly status: "none" }>;
    expect(second).not.toBe(first);
    expect(contributionReading(first, second)).toBe(first);
  });

  it("hands over the new reading when the value, the instant or the state moved", () => {
    const first = observed(true, 10);
    expect(contributionReading(first, observed(false, 10))).not.toBe(first);
    expect(contributionReading(first, observed(true, 11))).not.toBe(first);
    const held = withoutReckoning(
      topicReading({
        state: "held",
        value: PAYLOAD,
        asOfUt: value("ut", 10),
        grade: "disconnected",
        reckoning: { status: "none" },
      }),
    ) as TopicCurrency<unknown, { readonly status: "none" }>;
    expect(contributionReading(first, held)).toBe(held);
  });
});
