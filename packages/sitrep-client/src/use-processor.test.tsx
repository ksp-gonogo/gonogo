import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { clearProcessorRuntime } from "./processorEvaluator";
import { clearProcessors, defineProcessor } from "./processors";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { useProcessor } from "./use-processor";
import { ViewClock } from "./view-clock";

beforeEach(() => {
  clearProcessors();
  clearProcessorRuntime();
});

describe("useProcessor", () => {
  it("reads a processor's value through the provider-wired store and re-renders as it changes across frames", async () => {
    // A processor whose compute reads a mutable outside the graph lets the
    // test drive value changes deterministically without depending on the
    // topic-emit-through-store harness (topic dep resolution is the
    // evaluator's own concern, covered in processorEvaluator; this test is the
    // hook + TelemetryProvider wiring: activate on mount, evaluate on the
    // provider's frame, re-render on change).
    let source = 0;
    const handle = defineProcessor({
      id: "source-times-two",
      owner: "core",
      deps: [] as const,
      compute: () => source * 2,
    });

    function Widget() {
      const value = useProcessor(handle);
      return <div>value:{value === undefined ? "none" : value}</div>;
    }

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
        <Widget />
      </TelemetryProvider>,
    );

    // Before the first frame the evaluator has produced nothing.
    expect(screen.getByText("value:none")).toBeTruthy();

    source = 5;
    act(() => store.beginFrame());
    await waitFor(() => expect(screen.getByText("value:10")).toBeTruthy());

    source = 11;
    act(() => store.beginFrame());
    await waitFor(() => expect(screen.getByText("value:22")).toBeTruthy());
  });

  it("returns undefined with no TelemetryProvider mounted", () => {
    const handle = defineProcessor({
      id: "no-provider",
      owner: "core",
      deps: [] as const,
      compute: () => 1,
    });

    function Widget() {
      const value = useProcessor(handle);
      return <div>value:{value === undefined ? "none" : value}</div>;
    }

    render(<Widget />);
    expect(screen.getByText("value:none")).toBeTruthy();
  });
});
