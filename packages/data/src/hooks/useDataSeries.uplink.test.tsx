import { clearRegistry } from "@ksp-gonogo/core";
import {
  createFakeWallClock,
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import {
  DEFAULT_SITREP_CARRIED_TOPICS,
  registerBarePrimitiveTopic,
  registerTopicUnits,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDataSeries } from "./useDataSeries";

/**
 * The plotting half of the same question `uplinkFieldCatalog.test.ts` asks of
 * the picker: once an operator has picked an Uplink's field, does a series
 * actually arrive?
 *
 * The Uplink here is one this repo has never heard of, and it registers
 * exactly what an Uplink client package registers at module load. Nothing
 * names it in any first-party list, which is the whole point: a promotion
 * list written in this repo can never name a Topic a third party ships.
 */
const REACTOR = "acme.reactor";

registerBarePrimitiveTopic(REACTOR);
registerTopicUnits(REACTOR, { coreTempK: "K" });

function Probe() {
  const range = useDataSeries("data", "acme.reactor.coreTempK", 300);
  return (
    <div data-testid="range">
      t:{range.t.join(",")}|v:{range.v.join(",")}
    </div>
  );
}

function buildStreamFixture() {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  clock.scrubTo(100);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider
        client={client}
        store={store}
        // The app's own default: every first-party promotion, and no way for
        // it to mention an Uplink nobody in this repo has heard of.
        carriedChannels={DEFAULT_SITREP_CARRIED_TOPICS}
      >
        {children}
      </TelemetryProvider>
    );
  }

  return { transport, Provider };
}

beforeEach(() => clearRegistry());

describe("plotting an Uplink's own field", () => {
  it("subscribes to the Uplink's Topic and builds a series from it", async () => {
    const fixture = buildStreamFixture();

    render(
      <fixture.Provider>
        <Probe />
      </fixture.Provider>,
    );

    // `StubTransport.emit` is subscription-gated, so this is the read that
    // says whether the field is reachable at all rather than merely empty.
    expect(fixture.transport.isSubscribed(REACTOR)).toBe(true);

    act(() => {
      fixture.transport.emit(REACTOR, { coreTempK: 900 }, { validAt: 10 });
      fixture.transport.emit(REACTOR, { coreTempK: 1200 }, { validAt: 100 });
    });

    await waitFor(() => expect(readProbe()).toBe("t:10,100|v:900,1200"));
  });
});

function readProbe(): string {
  return screen.getByTestId("range").textContent ?? "";
}
