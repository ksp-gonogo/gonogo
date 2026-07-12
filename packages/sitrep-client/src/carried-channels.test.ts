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
});
