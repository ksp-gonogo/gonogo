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
import { type HandoverFixture, loadHandoverFixtures } from "./handoverFixture";
import { type FlightReading, LandingStatusComponent } from "./index";

/**
 * WHICH of `vessel.flight`'s two altitude models carried each frame of the
 * handover render set.
 *
 * This file exists because the app cannot say. `RECKONING_BASIS_PHRASE`
 * ("integrated forward at the last observed rate") lives in one place,
 * `packages/ui/src/LineChart.tsx`, and reaches only a chart's accessible name;
 * `LandingStatus` names no model at all, its only currency surface being
 * "Described from last known flight, not current". So a PNG of a carried
 * altitude cannot be captioned with what carried it, and a review render
 * attributing one by eye would be a claim rather than evidence.
 *
 * Each `__render_handover__` fixture states the model it expects in its own
 * `_meta.expectedBasis`, and this checks that claim against the real store,
 * through the real widget, on the same emit path the render harness uses. The
 * fixture holds the intent and the store holds the answer; two copies of the
 * answer would agree with each other forever.

 */

describe("the handover render set reaches the models it says it does", () => {
  let restoreResizeObserver: () => void;

  beforeEach(() => {
    for (const b of PerfBudget.getAll()) b.reset();
    // jsdom lays nothing out, and every plot on this widget is a chart that
    // draws "Chart too small to render" in an unmeasured box.
    restoreResizeObserver = installSizedResizeObserver({ w: 720, h: 640 });
    registerStockBodies();
  });

  afterEach(() => {
    restoreResizeObserver();
  });

  /**
   * The reading the widget's own subscription produced, off the fixture's wire.
   *
   * The widget is MOUNTED rather than the store fed directly, because
   * `StubTransport.emit` is subscription-gated exactly like production: nothing
   * is delivered until something has actually subscribed, so a store-only
   * version of this would be reading a topic the render path might never have
   * asked for.
   */
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
    /*
     * Inside `act`, because the widget is MOUNTED and every emit is a real
     * store push: a fixture's hundred frames delivered bare are a hundred
     * `useSyncExternalStore` re-renders outside React's own scope, and the
     * seven scenarios here were emitting 743 act warnings between them.
     */
    act(() => {
      for (const emit of fixture._stream.emits) {
        stream.emit(emit.channel, emit.value, emit.meta);
      }
    });
    /*
     * Read as the READING the contract declares, not as a plain `Reading`:
     * `vessel.flight.altitudeAsl` carries a `[SitrepReckonable]` mark, so its
     * refusals arrive with a `declined` beside them, and the plain shape has no
     * arm for that. `sampleReading` is generic over the payload and cannot know
     * which topics are marked, so the mark is stated here.
     */
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
        /*
         * The REASON is asserted, not just the absence of a model, because "no
         * model" is what every withdrawal in the tree looks like from here. The
         * one this set holds is the rate integration's horizon closing under
         * sensed deceleration; the crossing band used to produce a second,
         * the conic refusing on a floor the selector had never asked about, and
         * an assertion on absence alone would not have told the two apart.
         */
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
      /*
       * The ROOT entry, which is the one a whole-topic read is answered by, and
       * the field entry for the altitude, which is what says the altitude was
       * MOVED rather than copied. The conic moves both marked fields; the rate
       * integration moves the altitude alone and copies `orbitalSpeed`
       * verbatim, so the pair of assertions is also what tells the two branches
       * apart on the wire rather than by their arithmetic.
       */
      expect(reading.reckoning.basis).toBe(expectedBasis);
      expect(reading.reckoning.modelled).toEqual(
        expect.arrayContaining([{ path: "altitudeAsl", basis: expectedBasis }]),
      );
      // And the carried altitude is genuinely a different number from the
      // observation, or the picture would be showing an identity projection.
      expect(reading.reckoning.value.altitudeAsl.toWire()).not.toBe(
        reading.value.altitudeAsl.toWire(),
      );
    });
  }
});
