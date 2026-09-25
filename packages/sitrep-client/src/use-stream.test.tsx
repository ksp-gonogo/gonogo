import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider } from "./context";
import { createFakeWallClock } from "./fake-wall-clock";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { useStream } from "./use-stream";
import { ViewClock } from "./view-clock";

function setupFixture() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  function Provider({ children }: { children: React.ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        {children}
      </TelemetryProvider>
    );
  }
  return { transport, store, Provider };
}

/**
 * A figure derived from the stream, drawn the way a widget draws one: current
 * when observed, held and marked when the reading is stale, nothing otherwise.
 */
function DoubledAlt() {
  const alt = useStream<number>("v.alt");
  const figure =
    alt.state === "observed" || alt.state === "stale"
      ? alt.value * 2
      : undefined;
  return (
    <div>
      alt:{figure ?? NULL_DISPLAY}
      {alt.state === "stale" && " held"}
    </div>
  );
}

describe("useStream", () => {
  it("renders the latest stream value and updates on new data", async () => {
    const t = new StubTransport();
    const client = new TelemetryClient(t);
    render(
      <TelemetryProvider client={client}>
        <DoubledAlt />
      </TelemetryProvider>,
    );
    expect(screen.getByText(`alt:${NULL_DISPLAY}`)).toBeTruthy();
    act(() => {
      t.emit("v.alt", 123);
    });
    // `TelemetryProvider` coalesces `beginFrame()` to the next animation
    // frame rather than minting one per ingest, so
    // the re-render lands one frame after the emit, not synchronously.
    await waitFor(() => expect(screen.getByText("alt:246")).toBeTruthy());
  });

  it("answers pending with no provider mounted", () => {
    render(<DoubledAlt />);
    expect(screen.getByText(`alt:${NULL_DISPLAY}`)).toBeTruthy();
  });

  it("holds the last figure and marks it once the stream stops arriving", async () => {
    const { transport, store, Provider } = setupFixture();
    render(
      <Provider>
        <DoubledAlt />
      </Provider>,
    );
    act(() => {
      transport.emit("v.alt", 123);
      store.beginFrame();
    });
    await waitFor(() => expect(screen.getByText("alt:246")).toBeTruthy());

    act(() => {
      store.setTransportConnected(false);
      store.beginFrame();
    });

    await waitFor(() => expect(screen.getByText("alt:246 held")).toBeTruthy());
    await act(async () => {});
  });
});
