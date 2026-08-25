import {
  clearContributedDerivedChannels,
  contributeDerivedChannel,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import type { DerivedChannelDefinition } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { type ReactNode, useEffect, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

/**
 * A derived channel is the only mechanism that can join two Topics, so an
 * Uplink that models a quantity across a split contract has to contribute one.
 * Whether that channel survives depends on WHEN the Uplink's module graph runs
 * relative to the store being built, and the two screens answer that
 * differently.
 *
 * On the main screen `main.tsx` loads Uplink bundles before `renderApp()`, so
 * every contribution is in place before any store exists. On a station the
 * bundles cannot load until there is a peer-backed `TelemetryClient` to read
 * the roster off, which is why `StationScreen` mounts
 * `<SitrepTelemetryProvider>` as the PARENT of `<StationUplinkLoader>`. The
 * store is therefore built while the station knows its Uplink set is still
 * empty.
 *
 * Anyone reordering those two providers, or moving the contribution drain back
 * to store construction alone, should fail here rather than ship a station that
 * silently reads `undefined` for a channel the main screen resolves.
 */

const RAW_TOPIC = "lateuplink.raw";
const DERIVED_TOPIC = "lateuplink.doubled";

const LATE_CHANNEL: DerivedChannelDefinition<number> = {
  topic: DERIVED_TOPIC,
  inputs: [RAW_TOPIC],
  derive: (get) => {
    const point = get<{ n: number }>(RAW_TOPIC);
    if (!point) return undefined;
    if (point.payload === null) return null;
    return point.payload.n * 2;
  },
};

function Probe() {
  const value = useStream<number>(DERIVED_TOPIC);
  return (
    <div data-testid="derived">{value === undefined ? "blank" : value}</div>
  );
}

/**
 * Stands in for `StationUplinkLoader`: contributes on mount and gates its
 * children until the contribution has happened, the same order the real loader
 * imposes by not rendering the Dashboard until `loadEnabledUplinks` resolves.
 */
function LateLoader({ children }: { children: ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    contributeDerivedChannel(LATE_CHANNEL, "lateuplink");
    setLoaded(true);
  }, []);
  return loaded ? children : null;
}

describe("a station's Uplink loads after its store is built", () => {
  afterEach(() => {
    clearContributedDerivedChannels();
  });

  it("resolves a derived channel contributed after the provider mounted", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const view = render(
      <TelemetryProvider client={client}>
        <LateLoader>
          <Probe />
        </LateLoader>
      </TelemetryProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("derived")).toBeTruthy());
    const pastUt = Date.now() / 1000 - 10_000;
    act(() => {
      transport.emit(
        RAW_TOPIC,
        { n: 21 },
        { validAt: pastUt, deliveredAt: pastUt },
      );
    });

    await waitFor(() =>
      expect(screen.getByTestId("derived").textContent).toBe("42"),
    );

    view.unmount();
    await act(async () => {});
  });
});
