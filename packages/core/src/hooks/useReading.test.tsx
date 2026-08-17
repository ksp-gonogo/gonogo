import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { Quality, type TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { useReading } from "./useReading";

const TARGET = {
  name: "Mun",
  kind: 0,
} as unknown as TopicPayload<"vessel.target">;

/** Prints the reading's state and, where the type permits one, a value. */
function Probe() {
  const reading = useReading("vessel.target");
  if (reading.state === "pending") return <div>pending</div>;
  if (reading.state === "absent") return <div>absent@{reading.atUt}</div>;
  if (reading.state === "observed") {
    return (
      <div>
        observed:{String(reading.value.name)}@{reading.atUt}
      </div>
    );
  }
  if (reading.state === "reckonable") {
    return <div>reckonable:{reading.grade}</div>;
  }
  return (
    <div>
      stale:{reading.grade}:{String(reading.value.name)}
    </div>
  );
}

describe("useReading", () => {
  it("is pending before anything arrives, then observed once it does", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);

    render(
      <TelemetryProvider client={client}>
        <Probe />
      </TelemetryProvider>,
    );

    expect(screen.getByText("pending")).toBeTruthy();

    act(() => {
      transport.emit("vessel.target", TARGET, {
        quality: Quality.Loaded,
        source: "vessel:1",
      });
    });

    // The provider coalesces `beginFrame()` to the next animation frame, so the
    // read resolves a frame after the emit rather than synchronously.
    await waitFor(() =>
      expect(screen.getByText(/^observed:Mun@/)).toBeTruthy(),
    );
  });

  it("is pending, not stale, with no provider mounted", () => {
    // A widget on a disconnected dashboard has never observed anything, so it
    // has no last-observed value to present. Claiming `stale` would promise a
    // value the reading cannot supply.
    const { result } = renderHook(() => useReading("vessel.target"));
    expect(result.current).toEqual({ state: "pending" });
  });

  it("keeps the last real value reachable once the transport drops", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    // An explicit store so the test can drop the link: `StubTransport.status`
    // is a readonly `"connected"`, and the transport-down short-circuit is a
    // store-level fact anyway (`setTransportConnected`).
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
    );

    render(
      <TelemetryProvider client={client} store={store}>
        <Probe />
      </TelemetryProvider>,
    );

    act(() => {
      transport.emit("vessel.target", TARGET, {
        quality: Quality.Loaded,
        source: "vessel:1",
      });
    });
    await waitFor(() =>
      expect(screen.getByText(/^observed:Mun@/)).toBeTruthy(),
    );

    act(() => {
      store.setTransportConnected(false);
      store.beginFrame();
    });

    // `disconnected` rather than `held-stale`: the whole pipe is down, which is
    // a link-wide fact, not this one channel missing its cadence.
    await waitFor(() =>
      expect(screen.getByText("stale:disconnected:Mun")).toBeTruthy(),
    );
  });
});
