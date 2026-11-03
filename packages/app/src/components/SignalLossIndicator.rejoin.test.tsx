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

  let ut = 0;
  let epoch = 0;
  const emit = (topic: string, payload: unknown) =>
    transport.emit(topic, payload, {
      validAt: ut,
      deliveredAt: ut,
      timelineEpoch: epoch,
    });
  /* A live topic keeps arriving through a blackout and moves the view clock's horizon on. */
  const advance = async (seconds: number) => {
    await act(async () => {
      ut += seconds;
      wall.advanceBy(seconds);
      emit("vessel.comms", { connected: true, signalStrength: 0.5 });
      store.beginFrame();
      vi.advanceTimersByTime(seconds * 1000);
    });
  };
  const rejoin = () => {
    epoch += 1;
  };
  return { Provider, emit, advance, rejoin };
}

function elapsedSeconds(): number {
  const text = screen.getByRole("status").textContent ?? "";
  const minutes = /(\d+)\s*min/.exec(text);
  const seconds = /(\d+)\s*s\b/.exec(text);
  return Number(minutes?.[1] ?? 0) * 60 + Number(seconds?.[1] ?? 0);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SignalLossIndicator: a rejoin in the middle of a loss", () => {
  it("keeps counting from the start of the loss while the link report is awaited again", async () => {
    const fixture = setupStream();
    render(
      <fixture.Provider>
        <SignalLossIndicator />
      </fixture.Provider>,
    );

    await act(async () => {
      fixture.emit("comms.link", { connected: true });
    });
    await fixture.advance(DELAY_SECONDS);
    await act(async () => {
      fixture.emit("comms.link", { connected: false });
    });
    await fixture.advance(DELAY_SECONDS);
    await fixture.advance(60);
    expect(screen.getByText("SIGNAL LOSS")).toBeTruthy();
    const before = elapsedSeconds();
    expect(before).toBeGreaterThanOrEqual(55);

    fixture.rejoin();
    await fixture.advance(2);
    expect(screen.queryByText("SIGNAL LOSS")).toBeNull();

    await act(async () => {
      fixture.emit("comms.link", { connected: false });
    });
    await fixture.advance(DELAY_SECONDS);
    expect(screen.getByText("SIGNAL LOSS")).toBeTruthy();
    expect(elapsedSeconds()).toBeGreaterThanOrEqual(before);
  });

  it("starts a new count when the link reports up and goes down again", async () => {
    const fixture = setupStream();
    render(
      <fixture.Provider>
        <SignalLossIndicator />
      </fixture.Provider>,
    );

    await act(async () => {
      fixture.emit("comms.link", { connected: true });
    });
    await fixture.advance(DELAY_SECONDS);
    await act(async () => {
      fixture.emit("comms.link", { connected: false });
    });
    await fixture.advance(DELAY_SECONDS);
    await fixture.advance(60);
    expect(screen.getByText("SIGNAL LOSS")).toBeTruthy();
    const first = elapsedSeconds();

    await act(async () => {
      fixture.emit("comms.link", { connected: true });
    });
    await fixture.advance(DELAY_SECONDS);
    expect(screen.queryByText("SIGNAL LOSS")).toBeNull();

    await act(async () => {
      fixture.emit("comms.link", { connected: false });
    });
    await fixture.advance(DELAY_SECONDS);
    expect(screen.getByText("SIGNAL LOSS")).toBeTruthy();
    expect(elapsedSeconds()).toBeLessThan(first);
  });
});
