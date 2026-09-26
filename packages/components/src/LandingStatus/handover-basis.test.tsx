import {
  DashboardItemContext,
  PerfBudget,
  registerStockBodies,
} from "@ksp-gonogo/core";
import type { VesselFlight } from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import type { FlightReading } from "./CarriedAltitude";
import { type HandoverFixture, loadHandoverFixtures } from "./handoverFixture";
import { LandingStatusComponent } from "./index";

/**
 * Which of `vessel.flight`'s two altitude models carried each frame of the handover render set.
 * The widget names no model, so each fixture states the one it expects in `_meta.expectedBasis`, checked against the real store through the real widget on the render harness's emit path.
 */
describe("the handover render set reaches the models it says it does", () => {
  let restoreResizeObserver: () => void;

  beforeEach(() => {
    for (const b of PerfBudget.getAll()) b.reset();
    // jsdom lays nothing out, so every chart would draw its too-small message in an unmeasured box.
    restoreResizeObserver = installSizedResizeObserver({ w: 720, h: 640 });
    registerStockBodies();
  });

  afterEach(() => {
    restoreResizeObserver();
  });

  /** The reading the widget's own subscription produced; mounted, since the stub transport is subscription-gated like production. */
  function readFlight(fixture: HandoverFixture): FlightReading {
    const stream = setupStreamFixture({
      carriedChannels: fixture._stream.carriedChannels,
      pinnedUt: fixture._stream.pinnedUt,
      suspendFrames: true,
    });
    const tree = render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "handover" }}>
          <WidgetContributions Widget={LandingStatusComponent}>
            <LandingStatusComponent id="handover" w={8} h={12} />
          </WidgetContributions>
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
    // Inside act: every emit is a real store push into the mounted widget.
    act(() => {
      for (const emit of fixture._stream.emits) {
        stream.emit(emit.channel, emit.value, emit.meta);
      }
    });
    // Read as the contract's reckonable reading, since the marked `altitudeAsl` refusals carry a `declined` the plain shape lacks.
    const reading = stream.store.sampleReading<VesselFlight>(
      "vessel.flight",
    ) as FlightReading;
    act(() => {
      tree.unmount();
    });
    return reading;
  }

  for (const fixture of loadHandoverFixtures()) {
    const { scenario, expectedBasis } = fixture._meta;

    if (expectedBasis === "declined") {
      const decline = fixture._meta.expectedDecline;
      it(`${scenario}: no model is offered, and it withdraws on ${decline?.input}`, () => {
        // The reason is asserted, not just an absent model, since every withdrawal looks alike from here: this set holds the rate integration's horizon closing under sensed deceleration.
        const reading = readFlight(fixture);
        expect(reading.state).toBe("stale");
        if (reading.reckoning.status !== "declined") {
          throw new Error(
            "a declared-reckonable topic must say why it declined",
          );
        }
        expect(reading.reckoning.declined.reason).toBe(decline?.reason);
        expect(reading.reckoning.declined.input).toBe(decline?.input);
      });
      continue;
    }

    it(`${scenario}: the altitude is carried by ${expectedBasis}`, () => {
      const reading = readFlight(fixture);
      if (reading.reckoning.status !== "available") {
        throw new Error(
          `expected a model, got reckoning "${reading.reckoning.status}" (state "${reading.state}")`,
        );
      }
      if (reading.state !== "observed" && reading.state !== "stale") {
        throw new Error(`expected an observation, got "${reading.state}"`);
      }
      // The root entry answers a whole-topic read, and the field entry says the altitude was moved; the conic moves both marked fields while the rate integration copies `orbitalSpeed`, so the pair tells the branches apart.
      expect(reading.reckoning.basis).toBe(expectedBasis);
      expect(reading.reckoning.modelled).toEqual(
        expect.arrayContaining([{ path: "altitudeAsl", basis: expectedBasis }]),
      );
      // The carried altitude differs from the observation, or this would be an identity projection.
      expect(reading.reckoning.value.altitudeAsl.toWire()).not.toBe(
        reading.value.altitudeAsl.toWire(),
      );
    });
  }
});
