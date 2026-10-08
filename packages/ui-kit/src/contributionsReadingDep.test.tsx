import {
  clearContributions,
  registerContribution,
} from "@ksp-gonogo/sitrep-sdk/spine";
import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { useContributionsBySlotId } from "./contributionsRead";
import { ContributionsProvider } from "./contributionsRuntime";
import { WidgetMetaContext } from "./WidgetMetaContext";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface ContributionRegistry {
    "reading-dep-probe.rows": { entry: { label: string } };
  }
}

const SLOT = "reading-dep-probe.rows";

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
        value={{ componentId: "reading-dep-probe", contributionSlots: [SLOT] }}
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

describe("a contribution's reading dep", () => {
  it("receives the Topic's Reading, while a bare dep on the same Topic still receives the payload", () => {
    registerContribution({
      id: "bare",
      contributes: SLOT,
      deps: ["crash.hasRecent"],
      compute: (topics) => [
        { label: `bare:${String(topics["crash.hasRecent"]?.recent)}` },
      ],
    });
    registerContribution({
      id: "reading",
      contributes: SLOT,
      deps: [{ reading: "crash.hasRecent" }],
      compute: (topics) => {
        const reading = topics["crash.hasRecent"];
        return [
          {
            label:
              reading.state === "observed"
                ? `reading:${reading.state}:${String(reading.value.recent)}`
                : `reading:${reading.state}`,
          },
        ];
      },
    });
    const stream = mount();
    expect(screen.getByRole("status")).toHaveTextContent(
      "bare:undefined|reading:pending",
    );

    act(() => {
      stream.emit("crash.hasRecent", { recent: true });
      stream.store.beginFrame();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "bare:true|reading:observed:true",
    );
  });
});
