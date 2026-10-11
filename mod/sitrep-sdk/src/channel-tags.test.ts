import { describe, expect, it } from "vitest";
import { GENERATED_CONTRACT_TAGS } from "./__generated__/units";
import {
  channelKindOf,
  readDeclaredSampleKinds,
  sampleKindOf,
} from "./channel-tags";
import { TimelineStore } from "./spine/timeline-store";
import { ViewClock } from "./spine/view-clock";
import { makeMeta } from "./testing/stub-transport";

function store() {
  return new TimelineStore(
    new ViewClock({
      nowWall: () => 0,
      warpRate: () => 1,
      delaySeconds: () => 0,
    }),
  );
}

describe("a value's sample kind", () => {
  it("is the channel's own where nothing nearer declares one", () => {
    expect(sampleKindOf("vessel.flight", ["altitudeAsl"])).toBe("continuous");
    expect(sampleKindOf("career.status")).toBe("discrete");
    expect(sampleKindOf("crash.lastCrash")).toBe("event");
  });

  it("takes a value's own declaration over its channel's", () => {
    expect(sampleKindOf("vessel.propulsion", ["dryMass"])).toBe("discrete");
    expect(sampleKindOf("vessel.propulsion", ["totalMass"])).toBe("continuous");
  });

  it("finds a declaration made under a list, at any index", () => {
    expect(sampleKindOf("comms.path", ["hops", "0", "strength"])).toBe(
      "continuous",
    );
    expect(sampleKindOf("comms.path", ["hops", "3", "distanceMeters"])).toBe(
      "continuous",
    );
    expect(sampleKindOf("comms.path", ["hops"])).toBe("discrete");
  });

  it("holds a flag, an id, a name or an instant whatever its channel says", () => {
    expect(sampleKindOf("vessel.thermal", ["anyEnginesOverheating"])).toBe(
      "discrete",
    );
    expect(sampleKindOf("vessel.thermal", ["heatShieldTemp"])).toBe(
      "continuous",
    );
  });

  it("is an event everywhere inside an event channel", () => {
    expect(sampleKindOf("crash.lastCrash", ["ut"])).toBe("event");
  });

  it("is continuous for a channel nobody declares", () => {
    expect(sampleKindOf("nobody.declares.this")).toBe("continuous");
  });

  it("is continuous for every value a declared model carries forward", () => {
    // A model carries a value across the gap between samples, which only a continuous value has.
    for (const row of GENERATED_CONTRACT_TAGS.reckonable) {
      const path = row.field
        .split(".")
        .map((part) => (part === "*" ? "0" : part));
      expect({
        row: `${row.topic} ${row.field}`,
        kind: sampleKindOf(row.topic, path),
      }).toEqual({
        row: `${row.topic} ${row.field}`,
        kind: "continuous",
      });
    }
  });
});

describe("the mod's roster of kinds", () => {
  const roster = {
    sampleKinds: {
      topics: { "acme.level": "discrete", "vessel.flight": "discrete" },
      prefixes: { "acme.notices.": "event" },
    },
  };

  it("is read off system.uplinks, prefixes covering their namespace", () => {
    const declared = readDeclaredSampleKinds(roster);
    expect(channelKindOf("acme.level", declared)).toBe("discrete");
    expect(channelKindOf("acme.notices.alpha", declared)).toBe("event");
    expect(readDeclaredSampleKinds({})).toBeUndefined();
  });

  it("outranks the generated table once it has arrived", () => {
    const declared = readDeclaredSampleKinds(roster);
    expect(channelKindOf("vessel.flight")).toBe("continuous");
    expect(channelKindOf("vessel.flight", declared)).toBe("discrete");
  });

  it("reaches a store's answer for a field through the roster it ingested", () => {
    const s = store();
    expect(s.tagsOf("vessel.propulsion.dryMass").kind).toBe("discrete");
    s.ingest("system.uplinks", {
      validAt: 1,
      payload: { uplinks: [], ...roster },
      meta: makeMeta({ validAt: 1, deliveredAt: 1 }),
      epoch: 0,
    });
    expect(s.tagsOf("acme.notices.alpha").kind).toBe("event");
  });
});

describe("a store's tags for a key", () => {
  it("names the models declared on a field, and every model for a whole Topic", () => {
    const s = store();
    expect(
      s.tagsOf("vessel.flight.altitudeAsl").reckonable.map((row) => row.basis),
    ).toEqual([
      "kepler-propagation",
      "powered-integration",
      "rate-integration",
    ]);
    expect(s.tagsOf("vessel.flight.mach").reckonable).toEqual([]);
    expect(s.tagsOf("vessel.flight").reckonable.length).toBeGreaterThan(3);
  });
});

describe("an interpolated read between two samples", () => {
  function between(topic: string, before: unknown, after: unknown) {
    const s = new TimelineStore(
      // Five seconds of delay puts the view half way between the two samples.
      new ViewClock({
        nowWall: () => 0,
        warpRate: () => 1,
        delaySeconds: () => 5,
      }),
    );
    s.ingest(topic, {
      validAt: 10,
      payload: before,
      meta: makeMeta({ validAt: 10, deliveredAt: 10 }),
      epoch: 0,
    });
    s.ingest(topic, {
      validAt: 20,
      payload: after,
      meta: makeMeta({ validAt: 20, deliveredAt: 20 }),
      epoch: 0,
    });
    s.beginFrame();
    return s.sampleInterpolated<Record<string, number>>(topic)?.payload;
  }

  it("holds a discrete field and draws a continuous one beside it", () => {
    const payload = between(
      "vessel.propulsion",
      { dryMass: 10, totalMass: 30 },
      { dryMass: 8, totalMass: 20 },
    );
    expect(payload?.dryMass).toBe(10);
    expect(payload?.totalMass).toBeCloseTo(25);
  });

  it("never fractionalises an id", () => {
    const payload = between(
      "vessel.orbit",
      { referenceBodyIndex: 1, sma: 700_000 },
      { referenceBodyIndex: 2, sma: 800_000 },
    );
    expect(payload?.referenceBodyIndex).toBe(1);
    expect(payload?.sma).toBeCloseTo(750_000);
  });

  it("holds the whole of a discrete channel", () => {
    // Two throttle settings with nothing between them: a ramp here would be one the pilot never made.
    const payload = between(
      "vessel.control",
      { throttle: 0.2 },
      { throttle: 1 },
    );
    expect(payload?.throttle).toBe(0.2);
  });
});
