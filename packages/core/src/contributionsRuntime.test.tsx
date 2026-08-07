import {
  clearProcessors,
  defineProcessor,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { WidgetMetaContext } from "./contexts/WidgetMetaContext";
import { clearContributions, registerContribution } from "./contributions";
import {
  ContributionsProvider,
  useContributions,
} from "./contributionsRuntime";

declare module "./contributions" {
  interface ContributionRegistry {
    "fixture.rows": {
      entry: { id: string; label: string };
      topics: "vessel.orbit";
    };
    "fixture.other": {
      entry: { id: string; label: string };
      topics: never;
    };
    "fixture.slot0": { entry: { id: string; label: string }; topics: never };
    "fixture.slot1": { entry: { id: string; label: string }; topics: never };
    "fixture.slot2": { entry: { id: string; label: string }; topics: never };
    "fixture.slot3": { entry: { id: string; label: string }; topics: never };
    "fixture.slot4": { entry: { id: string; label: string }; topics: never };
    "fixture.slot5": { entry: { id: string; label: string }; topics: never };
    "fixture.slot6": { entry: { id: string; label: string }; topics: never };
    "fixture.slot7": { entry: { id: string; label: string }; topics: never };
    "fixture.slot8": { entry: { id: string; label: string }; topics: never };
    "fixture.slot9": { entry: { id: string; label: string }; topics: never };
  }
}

beforeEach(() => {
  clearContributions();
  clearProcessors();
});

function Harness({ slots }: { slots: readonly ["fixture.rows"] }) {
  return (
    <WidgetMetaContext.Provider
      value={{ componentId: "fixture-widget", contributionSlots: slots }}
    >
      <ContributionsProvider>
        <Rows />
      </ContributionsProvider>
    </WidgetMetaContext.Provider>
  );
}

function Rows() {
  const rows = useContributions("fixture.rows");
  return (
    <ul>
      {rows.map((r) => (
        <li key={r.contributionId}>{r.label}</li>
      ))}
    </ul>
  );
}

describe("useContributions", () => {
  it("renders entries from a registered pure contribution, reading its declared topic", async () => {
    registerContribution({
      id: "fixture-contrib",
      contributes: "fixture.rows",
      deps: ["vessel.orbit"],
      // `vessel.orbit`'s quantity fields arrive off the wire as bare numbers
      // and are wrapped into `Value<Unit>` objects by `StubTransport.emit`
      // (mirroring the real transport's `wrapTopicPayload`), so `sma` here
      // is a `Value<"m">`, not a plain number: `.magnitude` is the number.
      compute: (topics) =>
        topics["vessel.orbit"]
          ? [
              {
                id: "sma-row",
                label: `sma:${topics["vessel.orbit"].sma.magnitude}`,
              },
            ]
          : [],
    });

    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    render(
      <TelemetryProvider client={client}>
        <Harness slots={["fixture.rows"] as const} />
      </TelemetryProvider>,
    );

    act(() => {
      transport.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: 700_000,
          ecc: 0,
          inc: 0,
          lan: null,
          argPe: null,
          meanAnomalyAtEpoch: 0,
          epoch: 0,
          mu: 3.5316e12,
        },
        { quality: Quality.Loaded, source: "vessel:1" },
      );
    });

    await waitFor(() => expect(screen.getByText("sma:700000")).toBeTruthy());
  });

  it("a contribution's compute() receives a Processor dep's resolved value alongside Topic values", async () => {
    const processor = defineProcessor({
      id: "fixture-doubled",
      owner: "core",
      deps: [] as const,
      compute: () => 21,
    });
    registerContribution({
      id: "uses-processor",
      contributes: "fixture.rows",
      deps: [processor],
      compute: (topics) => [
        { id: "p-row", label: `p:${topics[processor.id]}` },
      ],
    });

    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    // Inject the store so the test drives the frame boundary deterministically
    // (the provider's own rAF-scheduled beginFrame races waitFor); the provider
    // still wires THIS store into the evaluator via setActiveTimelineStore.
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );

    render(
      <TelemetryProvider client={client} store={store}>
        <Harness slots={["fixture.rows"] as const} />
      </TelemetryProvider>,
    );

    // Pump one frame so the evaluator runs (it evaluates on the frame
    // boundary); the processor's value is constant, so one frame is enough.
    act(() => store.beginFrame());

    await waitFor(() => expect(screen.getByText("p:21")).toBeTruthy());
  });

  it("isolates a throwing contribution: logs once and contributes nothing, siblings still render", async () => {
    registerContribution({
      id: "ok",
      contributes: "fixture.rows",
      compute: () => [{ id: "ok-row", label: "fine" }],
    });
    registerContribution({
      id: "boom",
      contributes: "fixture.rows",
      compute: () => {
        throw new Error("kaboom");
      },
    });

    render(<Harness slots={["fixture.rows"] as const} />);

    await waitFor(() => expect(screen.getByText("fine")).toBeTruthy());
    expect(screen.queryByText(/kaboom/)).toBeNull();
  });

  it("overload B (array of slots) keys results by slot id, independent of each other", async () => {
    registerContribution({
      id: "rows-contrib",
      contributes: "fixture.rows",
      compute: () => [{ id: "row-1", label: "row one" }],
    });
    registerContribution({
      id: "other-contrib",
      contributes: "fixture.other",
      compute: () => [{ id: "other-1", label: "other one" }],
    });

    function MultiSlotWidget() {
      const bySlot = useContributions([
        "fixture.rows",
        "fixture.other",
      ] as const);
      return (
        <ul>
          {bySlot["fixture.rows"].map((r) => (
            <li key={r.contributionId}>rows:{r.label}</li>
          ))}
          {bySlot["fixture.other"].map((r) => (
            <li key={r.contributionId}>other:{r.label}</li>
          ))}
        </ul>
      );
    }

    render(
      <WidgetMetaContext.Provider
        value={{
          componentId: "fixture-multi-widget",
          contributionSlots: ["fixture.rows", "fixture.other"],
        }}
      >
        <ContributionsProvider>
          <MultiSlotWidget />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("rows:row one")).toBeTruthy());
    expect(screen.getByText("other:other one")).toBeTruthy();
  });

  it("has no cap on the number of slots requested in one call (10 slots, one useContributions call)", async () => {
    const slotIds = Array.from(
      { length: 10 },
      (_, i) => `fixture.slot${i}` as const,
    );

    for (const slotId of slotIds) {
      registerContribution({
        id: `${slotId}-contrib`,
        contributes: slotId,
        compute: () => [{ id: `${slotId}-row`, label: `label:${slotId}` }],
      });
    }

    function TenSlotWidget() {
      const bySlot = useContributions(slotIds);
      return (
        <ul>
          {slotIds.map((slotId) =>
            bySlot[slotId].map((r) => (
              <li key={r.contributionId}>{r.label}</li>
            )),
          )}
        </ul>
      );
    }

    render(
      <WidgetMetaContext.Provider
        value={{
          componentId: "fixture-ten-slot-widget",
          contributionSlots: slotIds,
        }}
      >
        <ContributionsProvider>
          <TenSlotWidget />
        </ContributionsProvider>
      </WidgetMetaContext.Provider>,
    );

    for (const slotId of slotIds) {
      await waitFor(() =>
        expect(screen.getByText(`label:${slotId}`)).toBeTruthy(),
      );
    }
  });
});
