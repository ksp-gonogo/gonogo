import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { render } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostRatePacer } from "./HostRatePacer";

const RATES = {
  tiers: [
    { tier: "base", samplesPerSecond: 1 },
    { tier: "fast", samplesPerSecond: 10 },
  ],
  topics: [],
};

let now = 0;
let visibility: DocumentVisibilityState = "visible";

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Runs the page for `seconds` with its 200 ms timers firing a whole second apart, as a browser runs a throttled page's. */
function runThrottled(seconds: number): void {
  for (let tick = 0; tick < seconds * 5; tick++) {
    now += 1_000;
    vi.advanceTimersByTime(200);
  }
}

function mountPacer() {
  const client = new TelemetryClient(new StubTransport());
  vi.spyOn(client, "getValue").mockImplementation((topic: string) =>
    topic === "system.dataRates" ? RATES : undefined,
  );
  const capRate = vi.spyOn(client, "capRate");
  const view = render(
    <TelemetryProvider client={client}>
      <HostRatePacer />
    </TelemetryProvider>,
  );
  return { capRate, view };
}

describe("HostRatePacer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    visibility = "visible";
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibility,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("caps the mod's fast tier while the visible main screen's timers run late", () => {
    const { capRate, view } = mountPacer();
    runThrottled(10);
    expect(capRate).toHaveBeenCalledWith("fast", 5);
    view.unmount();
  });

  it("leaves the mod's rate alone while the main screen is hidden, however late its timers run", () => {
    const { capRate, view } = mountPacer();
    setVisibility("hidden");
    runThrottled(30);
    expect(capRate).not.toHaveBeenCalled();
    view.unmount();
  });

  it("forgets the lateness from before it was shown again", () => {
    const { capRate, view } = mountPacer();
    runThrottled(2);
    setVisibility("hidden");
    runThrottled(10);
    setVisibility("visible");
    for (let tick = 0; tick < 25; tick++) {
      now += 200;
      vi.advanceTimersByTime(200);
    }
    expect(capRate).not.toHaveBeenCalled();
    view.unmount();
  });
});
