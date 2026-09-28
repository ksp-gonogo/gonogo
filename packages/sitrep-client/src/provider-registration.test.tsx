import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import {
  getActiveCarriedChannels,
  getActiveTelemetryClient,
  getViewUt,
  TelemetryProvider,
} from "./context";
import { StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function pinnedStore(ut: number): TimelineStore {
  const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
  clock.scrubTo(ut);
  return new TimelineStore(clock);
}

/**
 * The non-hook accessors follow the most recently mounted provider, and an
 * unmount hands them back to the one beneath rather than clearing them. The
 * app closes a modal (whose bridge re-provides the SAME client) while the
 * dashboard's provider stays mounted, and the dashboard's services keep
 * reading through these.
 */
describe("the active provider registration", () => {
  it("falls back to the provider still mounted when the later one unmounts", () => {
    const client = new TelemetryClient(new StubTransport());
    const dashboard = render(
      <TelemetryProvider
        client={client}
        store={pinnedStore(100)}
        carriedChannels={["vessel.orbit"]}
      >
        <div />
      </TelemetryProvider>,
    );
    const modal = render(
      <TelemetryProvider client={client} store={pinnedStore(200)}>
        <div />
      </TelemetryProvider>,
    );
    expect(getViewUt()).toBe(200);

    modal.unmount();

    expect(getActiveTelemetryClient()).toBe(client);
    expect(getViewUt()).toBe(100);
    expect(getActiveCarriedChannels()?.has("vessel.orbit")).toBe(true);

    dashboard.unmount();
    expect(getActiveTelemetryClient()).toBeUndefined();
    expect(getViewUt()).toBeUndefined();
    expect(getActiveCarriedChannels()).toBeUndefined();
  });

  it("keeps the later provider when the earlier one unmounts", () => {
    const first = new TelemetryClient(new StubTransport());
    const second = new TelemetryClient(new StubTransport());
    const earlier = render(
      <TelemetryProvider client={first} store={pinnedStore(100)}>
        <div />
      </TelemetryProvider>,
    );
    const later = render(
      <TelemetryProvider client={second} store={pinnedStore(200)}>
        <div />
      </TelemetryProvider>,
    );

    earlier.unmount();

    expect(getActiveTelemetryClient()).toBe(second);
    expect(getViewUt()).toBe(200);
    later.unmount();
  });
});
