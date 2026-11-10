import {
  defineProcessor,
  TelemetryClient,
  TelemetryProvider,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import type { TopicId } from "@ksp-gonogo/sitrep-sdk";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { type ReactNode, useEffect, useState } from "react";
import { describe, expect, it } from "vitest";

/**
 * A processor published as a Topic can join two Topics into something every
 * reader can use, so an Uplink that models a quantity across a split contract
 * publishes one. Whether it reaches the store depends on when the Uplink's module graph runs
 * relative to the store being built, and the two screens answer that
 * differently.
 *
 * On the main screen `main.tsx` loads Uplink bundles before `renderApp()`, so
 * every contribution is in place before any store exists. On a station the
 * bundles cannot load until there is a peer-backed `TelemetryClient` to read
 * the roster off, which is why `StationScreen` mounts
 * `<SitrepTelemetryProvider>` as the parent of `<StationUplinkLoader>`. The
 * store is therefore built while the station knows its Uplink set is still
 * empty.
 *
 * Anyone reordering those two providers, or moving the contribution drain back
 * to store construction alone, should fail here rather than ship a station that
 * silently reads `undefined` for a channel the main screen resolves.
 */

const RAW_TOPIC = "lateuplink.raw";
const DERIVED_TOPIC = "lateuplink.doubled";

function Probe() {
  const valueReading = useStream<number>(DERIVED_TOPIC);
  const value =
    valueReading.state === "observed" || valueReading.state === "held"
      ? valueReading.value
      : undefined;
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
    defineProcessor({
      id: "doubled",
      owner: "lateuplink",
      topic: DERIVED_TOPIC,
      deps: [RAW_TOPIC as TopicId],
      compute: ([raw]) => {
        const payload = raw as { n: number } | null | undefined;
        if (payload === undefined) return undefined;
        if (payload === null) return null;
        return payload.n * 2;
      },
    });
    setLoaded(true);
  }, []);
  return loaded ? children : null;
}

describe("a station's Uplink loads after its store is built", () => {
  it("resolves a published processor contributed after the provider mounted", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    render(
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
  });
});
