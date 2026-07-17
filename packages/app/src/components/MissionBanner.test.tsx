import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { render, screen, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { MissionBanner } from "./MissionBanner";

/**
 * Mounts a real `TelemetryProvider` (`TelemetryClient` + `TimelineStore`
 * over a `StubTransport`) around a genuine, live `ViewClock` — the same
 * shape `__tests__/flight-outcome-banner.test.tsx` uses. `MissionBanner`
 * doesn't declare any `dataRequirements`, so there's no topic for a test to
 * `transport.emit` through (`StubTransport.emit` gates delivery on the
 * topic actually being subscribed, and nothing subscribes here). Feeding
 * the clock directly via `clock.observeSample(validAt, deliveredAt)` — the
 * exact call `TimelineStore.ingest` makes on every sample, for every topic,
 * regardless of who's listening — is the correct low-level equivalent of
 * "a UT-bearing sample landed on the wire", without inventing an unrelated
 * fake topic just to route one through.
 */
function setupTelemetryStream() {
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock();
  const store = new TimelineStore(clock);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        {children}
      </TelemetryProvider>
    );
  }

  return {
    // Advances the live view clock as if a sample valid at `ut` had just
    // been delivered "now" — mirrors what `TimelineStore.ingest` does for
    // every incoming sample.
    advanceTo: (ut: number) => clock.observeSample(ut, ut),
    Provider,
  };
}

describe("MissionBanner", () => {
  it("shows the command centre and an em dash for the time before any sample lands", () => {
    const fixture = setupTelemetryStream();
    render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );

    expect(screen.getByText("KSC")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows a Y# D# in-game time once a sample lands, and updates live as UT advances", async () => {
    const fixture = setupTelemetryStream();
    render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );

    // formatKspDate(98_557) === "Y1 D5 03:22:37" (see ui-kit's own fixture).
    fixture.advanceTo(98_557);
    await waitFor(() => {
      expect(screen.getByText("Y1 D5 03:22:37")).toBeInTheDocument();
    });

    // formatKspDate(20_560_520) === "Y3 D100 05:15:20".
    fixture.advanceTo(20_560_520);
    await waitFor(() => {
      expect(screen.getByText("Y3 D100 05:15:20")).toBeInTheDocument();
    });
    expect(screen.queryByText("Y1 D5 03:22:37")).toBeNull();
  });

  it("exposes the banner as a single labelled group, not a live region", () => {
    const fixture = setupTelemetryStream();
    render(
      <fixture.Provider>
        <MissionBanner />
      </fixture.Provider>,
    );

    const banner = screen.getByRole("group", { name: "Mission status" });
    expect(banner.getAttribute("aria-live")).toBeNull();
    expect(banner.getAttribute("role")).not.toBe("status");
  });
});
