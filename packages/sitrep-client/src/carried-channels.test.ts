import { describe, expect, it } from "vitest";
import { isTopicCarried } from "./carried-channels";
import type { DerivedChannelDefinition } from "./timeline-store";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function makeStore(): TimelineStore {
  return new TimelineStore(
    new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
  );
}

const DERIVED: DerivedChannelDefinition<{ altitudeAsl: number }> = {
  topic: "vessel.state",
  inputs: ["vessel.orbit", "vessel.flight"],
  derive: () => ({ altitudeAsl: 1 }),
  fields: true,
};

describe("isTopicCarried", () => {
  it("a RAW topic is carried iff it is itself in the carried-channels set", () => {
    const store = makeStore();
    expect(
      isTopicCarried(store, new Set(["vessel.orbit"]), "vessel.orbit"),
    ).toBe(true);
    expect(
      isTopicCarried(store, new Set(["vessel.flight"]), "vessel.orbit"),
    ).toBe(false);
    expect(isTopicCarried(store, new Set(), "vessel.orbit")).toBe(false);
  });

  it("a DERIVED topic is carried only when ALL of its declared inputs are carried", () => {
    const store = makeStore();
    store.registerDerivedChannel(DERIVED);

    expect(isTopicCarried(store, new Set(), "vessel.state")).toBe(false);
    expect(
      isTopicCarried(store, new Set(["vessel.orbit"]), "vessel.state"),
    ).toBe(false); // only one of two inputs carried
    expect(
      isTopicCarried(
        store,
        new Set(["vessel.orbit", "vessel.flight"]),
        "vessel.state",
      ),
    ).toBe(true);
  });

  it("a field subtopic of a derived channel resolves through the same parent inputs", () => {
    const store = makeStore();
    store.registerDerivedChannel(DERIVED);

    expect(
      isTopicCarried(
        store,
        new Set(["vessel.orbit"]),
        "vessel.state.altitudeAsl",
      ),
    ).toBe(false);
    expect(
      isTopicCarried(
        store,
        new Set(["vessel.orbit", "vessel.flight"]),
        "vessel.state.altitudeAsl",
      ),
    ).toBe(true);
  });

  describe("carried namespace prefixes (trailing-dot entries)", () => {
    // These isolate the GATE's prefix logic: they feed it already-resolved raw
    // inputs via an identity store. In production the REAL store must ALSO
    // resolve a dynamic topic to that whole identity first — see
    // `resolveRawFieldSubtopic`'s 2-segment mis-parse and its
    // `dynamicWholeTopicPrefixes` exemption. A synthetic namespace keeps this
    // mechanism test free of any mod token.
    const idStore = { resolveSubscriptionTopics: (t: string) => [t] };

    it("carries any raw topic under a trailing-dot prefix entry", () => {
      const carried = new Set(["ns.dynamic."]);
      expect(isTopicCarried(idStore, carried, "ns.dynamic.Kerbin.8")).toBe(
        true,
      );
      expect(isTopicCarried(idStore, carried, "ns.dynamic.anything")).toBe(
        true,
      );
    });

    it("a prefix entry does NOT match a lookalike outside its namespace", () => {
      const carried = new Set(["ns.dynamic."]);
      // no dot boundary — must not be swallowed by the prefix
      expect(isTopicCarried(idStore, carried, "ns.dynamicX")).toBe(false);
      // the bare prefix stem (no trailing segment) is not a real wire topic
      expect(isTopicCarried(idStore, carried, "ns.dynamic")).toBe(false);
      // an unrelated namespace stays uncarried
      expect(isTopicCarried(idStore, carried, "other.topic")).toBe(false);
    });

    it("exact and prefix entries coexist; exact membership is unaffected", () => {
      const carried = new Set(["vessel.orbit", "ns.dynamic."]);
      expect(isTopicCarried(idStore, carried, "vessel.orbit")).toBe(true);
      expect(isTopicCarried(idStore, carried, "ns.dynamic.42")).toBe(true);
      expect(isTopicCarried(idStore, carried, "vessel.flight")).toBe(false);
    });
  });
});
