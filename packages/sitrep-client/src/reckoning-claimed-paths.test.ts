import { type TopicPayload, value } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { clearReckoners, registerReckoner } from "./reckoners";
import { makeMeta } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

type Flight = TopicPayload<"vessel.flight">;

function storeWith(payload: Partial<Flight>): TimelineStore {
  const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
  clock.scrubTo(40);
  const store = new TimelineStore(clock);
  store.beginFrame();
  store.ingest("vessel.flight", {
    validAt: 10,
    payload: payload as Flight,
    meta: makeMeta({ validAt: 10, deliveredAt: 10 }),
    epoch: 0,
  });
  store.beginFrame();
  return store;
}

/** A model that claims the root and `claimed`, and returns exactly `returned`. */
function registerClaiming(claimed: string, returned: Partial<Flight>) {
  registerReckoner("vessel.flight", "test", {
    deps: [],
    reckon: () => ({
      modelled: [
        { path: "", basis: "kepler-propagation" },
        { path: claimed, basis: "rate-integration" },
      ],
      reckon: () => returned as Flight,
    }),
  });
}

afterEach(() => clearReckoners());

describe("a model may only claim paths its result carries", () => {
  it("refuses a claim on a path the result does not carry", () => {
    registerClaiming("ghost", { altitudeAsl: value("m", 5) });
    const store = storeWith({ altitudeAsl: value("m", 5) });

    expect(() => store.sampleReading<Flight>("vessel.flight")).toThrow(
      /claims to move "ghost".*no "ghost" there/s,
    );
  });

  it("names the segment where a nested claim falls off", () => {
    registerClaiming("altitudeAsl.nothing", { altitudeAsl: value("m", 4) });
    const store = storeWith({ altitudeAsl: value("m", 5) });

    expect(() => store.sampleReading<Flight>("vessel.flight")).toThrow(
      /"altitudeAsl\.nothing".*no "nothing" there/s,
    );
  });

  it("accepts a claimed field the model carries as undefined", () => {
    registerClaiming("altitudeAsl", { altitudeAsl: undefined });
    const store = storeWith({ altitudeAsl: value("m", 5) });

    expect(store.sampleReading<Flight>("vessel.flight").reckoning.status).toBe(
      "available",
    );
  });

  it("accepts a claim on a path the result carries", () => {
    registerClaiming("altitudeAsl", { altitudeAsl: value("m", 4) });
    const store = storeWith({ altitudeAsl: value("m", 5) });

    expect(
      store.sampleReading<Flight>("vessel.flight").altitudeAsl.reckoning.status,
    ).toBe("available");
  });
});

describe("a field the payload does not carry is absent, never an observation without a value", () => {
  it("reads absent where the wire omitted the field", () => {
    const store = storeWith({ altitudeAsl: value("m", 5) });
    const reading = store.sampleReading<Flight>("vessel.flight");

    expect(reading.altitudeAsl.state).toBe("observed");
    expect(reading.latitude.state).toBe("absent");
    expect(reading.latitude.value).toBeUndefined();
  });

  it("reads absent where the wire carried null", () => {
    const clock = new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 });
    clock.scrubTo(40);
    const store = new TimelineStore(clock);
    store.beginFrame();
    store.ingest("dv.stages", {
      validAt: 10,
      payload: [{ stage: 1, dvVac: null }],
      meta: makeMeta({ validAt: 10, deliveredAt: 10 }),
      epoch: 0,
    });
    store.beginFrame();

    const stages = store.sampleReading<TopicPayload<"dv.stages">>("dv.stages");

    expect(stages[0].dvVac.state).toBe("absent");
  });
});
