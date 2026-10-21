import {
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import {
  createFakeWallClock,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignalLossIndicator } from "./SignalLossIndicator";

const DELAY_SECONDS = 5;

function setupStream() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => DELAY_SECONDS,
  });
  const store = new TimelineStore(clock);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        {children}
      </TelemetryProvider>
    );
  }

  const firstReport = () =>
    act(async () => {
      transport.emit(
        "comms.link",
        { connected: true },
        { validAt: 0, deliveredAt: 0 },
      );
      wall.advanceBy(DELAY_SECONDS);
      store.beginFrame();
    });

  return { Provider, firstReport };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SignalLossIndicator: the first light-time", () => {
  it("stays quiet at first, then says it awaits the first signal, never signal loss, until the first report lands", async () => {
    const fixture = setupStream();
    render(
      <fixture.Provider>
        <SignalLossIndicator />
      </fixture.Provider>,
    );

    expect(screen.queryByText(/Awaiting first signal/)).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/Awaiting first signal/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      `${DELAY_SECONDS}s`,
    );
    expect(screen.queryByText("SIGNAL LOSS")).toBeNull();
    expect(screen.queryByText("PARTIAL CONTROL")).toBeNull();

    await fixture.firstReport();
    expect(screen.queryByText(/Awaiting first signal/)).toBeNull();
    expect(screen.queryByText("SIGNAL LOSS")).toBeNull();
  });

  it("never says awaiting when the first report lands within the grace", async () => {
    const fixture = setupStream();
    render(
      <fixture.Provider>
        <SignalLossIndicator />
      </fixture.Provider>,
    );

    await fixture.firstReport();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText(/Awaiting first signal/)).toBeNull();
  });
});
