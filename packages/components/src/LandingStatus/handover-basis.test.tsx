import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DashboardItemContext,
  PerfBudget,
  registerStockBodies,
} from "@ksp-gonogo/core";
import type { ReckonableReading, VesselFlight } from "@ksp-gonogo/sitrep-sdk";
import { act, render } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  installSizedResizeObserver,
  WidgetContributions,
} from "../test/widgetDomSnapshot";
import { LandingStatusComponent } from "./index";

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
 *
 * It walks the DIRECTORY rather than a list, so a frame added to the set is
 * covered without being remembered here.
 */

const FIXTURES_DIR = join(__dirname, "__render_handover__");

/** The two fields `VesselFlight.AltitudeAsl`'s mark declares as reckonable. */
type FlightReading = ReckonableReading<
  VesselFlight,
  "altitudeAsl" | "orbitalSpeed"
>;

interface StreamEmit {
  channel: string;
  value: unknown;
  meta?: Record<string, unknown>;
}

interface HandoverFixture {
  _meta: {
    scenario: string;
    expectedBasis: string;
    /** Present on a `declined` frame; see the generator's own `Frame.decline`. */
    expectedDecline?: { reason: string; input: string };
  };
  _stream: {
    carriedChannels: string[];
    pinnedUt: number;
    emits: StreamEmit[];
  };
}

/** A type predicate, so every property read below narrows rather than asserts. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * One fixture, with the fields this file actually reads checked on the way in.
 *
 * Validated rather than asserted, because a fixture that has drifted out of
 * shape must fail HERE, naming itself, and not two frames later as an
 * unreadable `expectedBasis`. The generator writes these files, so the shape is
 * ours on both sides and a silent `undefined` would be a test that graded
 * nothing and passed.
 *
 * Built field by field off `isRecord` rather than with one cast at the top: an
 * assertion out of `unknown` is what `unknown-cast.test.ts` is for, and the
 * whole value of a check here is that it looked.
 */
function parseFixture(file: string, raw: unknown): HandoverFixture {
  const bad = (why: string): never => {
    throw new Error(`${file}: ${why}`);
  };
  if (!isRecord(raw)) return bad("not an object");
  const meta = raw._meta;
  const stream = raw._stream;
  if (!isRecord(meta)) return bad("no _meta");
  if (!isRecord(stream)) return bad("no _stream");
  const { scenario, expectedBasis, expectedDecline } = meta;
  const { carriedChannels, pinnedUt, emits } = stream;
  if (typeof scenario !== "string")
    return bad("_meta.scenario is not a string");
  if (typeof expectedBasis !== "string") {
    return bad("_meta.expectedBasis is not a string");
  }
  if (!Array.isArray(carriedChannels) || !Array.isArray(emits)) {
    return bad("_stream.carriedChannels and .emits must both be arrays");
  }
  if (typeof pinnedUt !== "number") {
    return bad("_stream.pinnedUt is not a number");
  }
  let decline: { reason: string; input: string } | undefined;
  if (expectedBasis === "declined") {
    if (!isRecord(expectedDecline)) {
      return bad("a declined frame needs _meta.expectedDecline");
    }
    const { reason, input } = expectedDecline;
    if (typeof reason !== "string" || typeof input !== "string") {
      return bad("_meta.expectedDecline needs a string reason and input");
    }
    decline = { reason, input };
  }
  const parsedEmits: StreamEmit[] = emits.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.channel !== "string") {
      return bad("an emit has no channel");
    }
    return {
      channel: entry.channel,
      value: entry.value,
      meta: isRecord(entry.meta) ? entry.meta : undefined,
    };
  });
  return {
    _meta: { scenario, expectedBasis, expectedDecline: decline },
    _stream: {
      carriedChannels: carriedChannels.map(String),
      pinnedUt,
      emits: parsedEmits,
    },
  };
}

function loadFixtures(): HandoverFixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) =>
      parseFixture(f, JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf8"))),
    );
}

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

  for (const fixture of loadFixtures()) {
    const { scenario, expectedBasis } = fixture._meta;

    if (expectedBasis === "declined") {
      const decline = fixture._meta.expectedDecline;
      it(`${scenario}: no model is offered, and it withdraws on ${decline?.input}`, () => {
        /*
         * The REASON is asserted, not just the absence of a model, because the
         * set holds two withdrawals that are not the same event: this model's
         * horizon closing under sensed deceleration, and the crossing band
         * where the conic is selected on the observed altitude and then refuses
         * on the radius it solves for. "No model" is true of both.
         */
        const reading = readFlight(fixture);
        expect(reading.reckoning).toBe("none");
        expect(reading.state).toBe("stale");
        if (!("declined" in reading)) {
          throw new Error(
            "a declared-reckonable topic must say why it declined",
          );
        }
        expect(reading.declined.reason).toBe(decline?.reason);
        expect(reading.declined.input).toBe(decline?.input);
      });
      continue;
    }

    it(`${scenario}: the altitude is carried by ${expectedBasis}`, () => {
      const reading = readFlight(fixture);
      if (reading.reckoning !== "available") {
        throw new Error(
          `expected a model, got reckoning "${reading.reckoning}" (state "${reading.state}")`,
        );
      }
      /*
       * The ROOT entry, which is the one a whole-topic read is answered by, and
       * the field entry for the altitude, which is what says the altitude was
       * MOVED rather than copied. The conic moves both marked fields; the rate
       * integration moves the altitude alone and copies `orbitalSpeed`
       * verbatim, so the pair of assertions is also what tells the two branches
       * apart on the wire rather than by their arithmetic.
       */
      expect(reading.reckoned.basis).toBe(expectedBasis);
      expect(reading.reckoned.modelled).toEqual(
        expect.arrayContaining([{ path: "altitudeAsl", basis: expectedBasis }]),
      );
      // And the carried altitude is genuinely a different number from the
      // observation, or the picture would be showing an identity projection.
      expect(reading.reckoned.value.altitudeAsl.toWire()).not.toBe(
        reading.value.altitudeAsl.toWire(),
      );
    });
  }
});
