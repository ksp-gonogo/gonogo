import "./reckoner-test-topics";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  bandFor,
  bandIn,
  bandIsWellFormed,
  bandSide,
  type ReckonerDefinition,
  type UncertaintyBand,
} from "./reading";
import { clearReckoners, registerReckoner } from "./reckoners";
import { makeMeta } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * The uncertainty band: how well a model knows the number it just produced.
 *
 * Two halves are tested here because they fail differently. The consumer
 * helpers are pure and answer a question a widget asks; the PLUMBING is where
 * a band can silently go missing, and a missing band reads downstream exactly
 * like a model that honestly would not say. So every plumbing case asserts the
 * band ARRIVED, not merely that nothing threw.
 */

function newStore(viewUt: number): TimelineStore {
  const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
  clock.scrubTo(viewUt);
  const store = new TimelineStore(clock);
  store.beginFrame();
  return store;
}

function ingestPoint(
  store: TimelineStore,
  topic: string,
  validAt: number,
  payload: unknown,
): void {
  store.ingest(topic, {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  });
}

function band(
  lo: number,
  v: number,
  hi: number,
  kind: "bound" | "sigma1" = "bound",
): UncertaintyBand<"m"> {
  return {
    value: value("m", v),
    lo: value("m", lo),
    hi: value("m", hi),
    kind,
  };
}

afterEach(() => clearReckoners());

describe("bandIsWellFormed", () => {
  it("accepts an asymmetric interval bracketing its value", () => {
    expect(bandIsWellFormed(band(90, 100, 130))).toBe(true);
  });

  it("accepts a zero-width band, which is a strong claim rather than a broken one", () => {
    expect(bandIsWellFormed(band(100, 100, 100))).toBe(true);
  });

  it("rejects a value outside its own interval", () => {
    expect(bandIsWellFormed(band(90, 140, 130))).toBe(false);
    expect(bandIsWellFormed(band(90, 80, 130))).toBe(false);
  });

  it("rejects ends in a different unit from the value", () => {
    const mixed: UncertaintyBand = {
      value: value("m", 100),
      lo: value("km", 0.09),
      hi: value("m", 130),
      kind: "bound",
    };
    expect(bandIsWellFormed(mixed)).toBe(false);
  });

  it("rejects a non-finite end", () => {
    expect(bandIsWellFormed(band(Number.NEGATIVE_INFINITY, 100, 130))).toBe(
      false,
    );
  });
});

describe("bandSide", () => {
  it("answers below when the whole interval is under the threshold", () => {
    expect(bandSide(band(90, 100, 130), value("m", 200))).toBe("below");
  });

  it("answers above when the whole interval is over it", () => {
    expect(bandSide(band(90, 100, 130), value("m", 50))).toBe("above");
  });

  it("answers straddles when the interval spans it", () => {
    expect(bandSide(band(90, 100, 130), value("m", 120))).toBe("straddles");
  });

  /*
   * The inclusive boundary, and it is a decision rather than an accident: an
   * interval that closes exactly on a limit has not crossed it, and calling
   * that unresolved would make every band landing on a round number
   * unanswerable.
   */
  it("treats an end landing exactly on the threshold as not crossing it", () => {
    expect(bandSide(band(90, 100, 130), value("m", 130))).toBe("below");
    expect(bandSide(band(90, 100, 130), value("m", 90))).toBe("above");
  });
});

describe("bandIn", () => {
  it("narrows a band already in the wanted unit", () => {
    const narrowed = bandIn(band(90, 100, 130), "m");
    expect(narrowed?.hi.magnitude).toBe(130);
  });

  /*
   * The reason this CHECKS rather than casts. `ReckonedBands` is keyed by a
   * runtime path, so a producer banding a field in the wrong unit is invisible
   * to the compiler, and a consumer reading it as its own unit would grade
   * kilometres against a metre threshold.
   */
  it("refuses a band in another unit rather than relabelling it", () => {
    expect(bandIn(band(90, 100, 130), "m/s")).toBeUndefined();
  });

  it("refuses a malformed band, so a bad interval reaches nobody typed", () => {
    expect(bandIn(band(90, 140, 130), "m")).toBeUndefined();
  });

  it("passes an absent band straight through", () => {
    expect(bandIn(undefined, "m")).toBeUndefined();
  });
});

describe("a reading carries the band its model offered", () => {
  /** A model that widens with how far it has been asked to carry the value. */
  function wideningReckoner(perSecond: number): ReckonerDefinition<number> {
    return {
      deps: [],
      reckon: (point) => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: (at: number) =>
          (point.payload as number) + (at - point.validAt),
        bandAt: (at: number) => {
          const carried = at - point.validAt;
          const v = (point.payload as number) + carried;
          const spread = carried * perSecond;
          return {
            "": {
              value: value("m", v),
              // Asymmetric on purpose: a model that is wrong in one direction
              // more than the other is the case the type exists for.
              lo: value("m", v - spread),
              hi: value("m", v + spread * 3),
              kind: "sigma1",
            },
          };
        },
      }),
    };
  }

  it("puts the model's band on the reckoning, keyed by path", () => {
    const store = newStore(40);
    registerReckoner("test.temperature", "test", wideningReckoner(0.5));
    ingestPoint(store, "test.temperature", 10, 100);
    store.setTransportConnected(false);
    store.beginFrame();

    const reading = store.sampleReading<number>("test.temperature");
    if (reading.reckoning !== "available") {
      throw new Error(`expected a model, got ${reading.reckoning}`);
    }
    const carried = bandFor(reading.reckoned);
    expect(carried).toBeDefined();
    expect(carried?.kind).toBe("sigma1");
    // 30 s carried at 0.5/s: 15 below, 45 above, around a value of 130.
    expect(carried?.value.magnitude).toBeCloseTo(130);
    expect(carried?.lo.magnitude).toBeCloseTo(115);
    expect(carried?.hi.magnitude).toBeCloseTo(175);
    expect(bandIsWellFormed(carried as UncertaintyBand)).toBe(true);
  });

  it("leaves bands absent for a model that offers none", () => {
    const store = newStore(40);
    registerReckoner("test.temperature", "test", {
      deps: [],
      reckon: (point) => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => point.payload as number,
      }),
    });
    ingestPoint(store, "test.temperature", 10, 100);
    store.setTransportConnected(false);
    store.beginFrame();

    const reading = store.sampleReading<number>("test.temperature");
    if (reading.reckoning !== "available") {
      throw new Error(`expected a model, got ${reading.reckoning}`);
    }
    expect(reading.reckoned.bands).toBeUndefined();
    expect(bandFor(reading.reckoned)).toBeUndefined();
  });

  /*
   * The band is a function of the VIEW TIME, and this is the assertion that
   * says so. A `bandAt` called once and cached against the reading, or asked
   * at the observation's own instant instead of the frame's, would give a band
   * that never widened while the value it describes kept being carried
   * further, which is precisely the false confidence the band exists to
   * remove.
   */
  it("widens as the frame's view time runs away from the observation", () => {
    const store = newStore(20);
    registerReckoner("test.temperature", "test", wideningReckoner(0.5));
    ingestPoint(store, "test.temperature", 10, 100);
    store.setTransportConnected(false);
    store.beginFrame();

    const near = store.sampleReading<number>("test.temperature");
    if (near.reckoning !== "available") throw new Error("expected a model");
    const nearWidth =
      (bandFor(near.reckoned)?.hi.magnitude ?? 0) -
      (bandFor(near.reckoned)?.lo.magnitude ?? 0);

    store.clock.scrubTo(120);
    store.beginFrame();
    const far = store.sampleReading<number>("test.temperature");
    if (far.reckoning !== "available") throw new Error("expected a model");
    const farWidth =
      (bandFor(far.reckoned)?.hi.magnitude ?? 0) -
      (bandFor(far.reckoned)?.lo.magnitude ?? 0);

    expect(farWidth).toBeGreaterThan(nearWidth);
  });
});

describe("a reckoned tail carries the band per instant", () => {
  function wideningReckoner(): ReckonerDefinition<number> {
    return {
      deps: [],
      reckon: (point) => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: (at: number) =>
          (point.payload as number) + (at - point.validAt),
        bandAt: (at: number) => {
          const carried = at - point.validAt;
          const v = (point.payload as number) + carried;
          return {
            "": {
              value: value("m", v),
              lo: value("m", v - carried),
              hi: value("m", v + carried * 2),
              kind: "bound",
            },
          };
        },
      }),
    };
  }

  it("widens down the tail rather than repeating one interval", () => {
    const store = newStore(50);
    registerReckoner("test.temperature", "test", wideningReckoner());
    ingestPoint(store, "test.temperature", 10, 0);
    ingestPoint(store, "test.temperature", 20, 0);
    ingestPoint(store, "test.temperature", 30, 0);
    store.setTransportConnected(false);
    store.beginFrame();

    const tail = store.sampleReckonedTail<number>("test.temperature", 0, 50);
    expect(tail.map((s) => s.atUt)).toEqual([40, 50]);
    expect(tail.every((s) => s.bandKind === "bound")).toBe(true);
    const widths = tail.map((s) => (s.bandHi as number) - (s.bandLo as number));
    expect(widths[0]).toBeGreaterThan(0);
    expect(widths[1]).toBeGreaterThan(widths[0]);
  });

  /*
   * A malformed band must not cost the operator the trace. The model's answer
   * is still its answer, so the instant is drawn and only the shading is
   * withheld: refusing the point would turn a producer's arithmetic slip into
   * a hole in the line.
   */
  it("drops a malformed band and still draws the instant", () => {
    const store = newStore(50);
    registerReckoner("test.temperature", "test", {
      deps: [],
      reckon: (point) => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => point.payload as number,
        bandAt: () => ({
          // Inverted: hi below lo, and the value outside both.
          "": {
            value: value("m", 100),
            lo: value("m", 130),
            hi: value("m", 90),
            kind: "bound",
          },
        }),
      }),
    });
    ingestPoint(store, "test.temperature", 10, 7);
    ingestPoint(store, "test.temperature", 20, 7);
    store.setTransportConnected(false);
    store.beginFrame();

    const tail = store.sampleReckonedTail<number>("test.temperature", 0, 50);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((s) => s.value === 7)).toBe(true);
    expect(tail.every((s) => s.bandLo === undefined)).toBe(true);
    expect(tail.every((s) => s.bandKind === undefined)).toBe(true);
  });

  it("leaves a bandless model's tail bandless", () => {
    const store = newStore(50);
    registerReckoner("test.temperature", "test", {
      deps: [],
      reckon: (point) => ({
        modelled: [{ path: "", basis: "rate-integration" }],
        reckon: () => point.payload as number,
      }),
    });
    ingestPoint(store, "test.temperature", 10, 3);
    ingestPoint(store, "test.temperature", 20, 3);
    store.setTransportConnected(false);
    store.beginFrame();

    const tail = store.sampleReckonedTail<number>("test.temperature", 0, 50);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((s) => s.bandLo === undefined)).toBe(true);
  });
});

/**
 * A FIELD read borrows its record's model, and it has to borrow the band the
 * same way or every plotted field-subtopic silently loses its shading. What it
 * must NOT borrow is a band declared at a shorter path: a basis is a property
 * of the model and inherits down the tree, two numbers in a quantity's unit do
 * not.
 */
describe("a field subtopic borrows its record's band, at its own path only", () => {
  function contactReckoner(bandPath: string): ReckonerDefinition<{
    relativePosition: number;
    name: string;
  }> {
    return {
      deps: [],
      reckon: (point) => ({
        modelled: [
          { path: "relativePosition", basis: "linear-dead-reckoning" },
        ],
        reckon: () => ({
          relativePosition:
            (point.payload as { relativePosition: number }).relativePosition +
            5,
          name: "modelled",
        }),
        bandAt: () => ({
          [bandPath]: {
            value: value("m", 105),
            lo: value("m", 100),
            hi: value("m", 130),
            kind: "bound",
          },
        }),
      }),
    };
  }

  function ingestContact(store: TimelineStore): void {
    for (const at of [10, 20]) {
      ingestPoint(store, "test.contact", at, {
        relativePosition: 100,
        name: "probe",
      });
    }
    store.setTransportConnected(false);
    store.beginFrame();
  }

  it("carries a band declared at the field's own path", () => {
    const store = newStore(40);
    registerReckoner(
      "test.contact",
      "test",
      contactReckoner("relativePosition"),
    );
    ingestContact(store);

    const reading = store.sampleReading<number>(
      "test.contact.relativePosition",
    );
    if (reading.reckoning !== "available") {
      throw new Error(`expected a model, got ${reading.reckoning}`);
    }
    const carried = bandFor(reading.reckoned);
    expect(carried?.lo.magnitude).toBe(100);
    expect(carried?.hi.magnitude).toBe(130);
  });

  it("refuses a band declared on the payload root, which is not this field's", () => {
    const store = newStore(40);
    registerReckoner("test.contact", "test", contactReckoner(""));
    ingestContact(store);

    const reading = store.sampleReading<number>(
      "test.contact.relativePosition",
    );
    if (reading.reckoning !== "available") {
      throw new Error(`expected a model, got ${reading.reckoning}`);
    }
    expect(bandFor(reading.reckoned)).toBeUndefined();
  });

  it("carries it onto the plotted tail as well as the point read", () => {
    const store = newStore(40);
    registerReckoner(
      "test.contact",
      "test",
      contactReckoner("relativePosition"),
    );
    ingestContact(store);

    const tail = store.sampleReckonedTail<number>(
      "test.contact.relativePosition",
      0,
      40,
    );
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((s) => s.bandLo === 100 && s.bandHi === 130)).toBe(true);
    expect(tail.every((s) => s.bandKind === "bound")).toBe(true);
  });
});
