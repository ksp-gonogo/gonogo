import "./reckoner-test-topics";
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk/spine";
import { afterEach, describe, expect, it } from "vitest";
import { clearReckoners } from "./reckoners";
import { makeMeta } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

/**
 * A model that refuses must say so: a consumer that cannot tell "this model
 * withheld its answer" from "nothing models this" goes on to compute from the
 * raw values the model withheld.
 */

afterEach(() => clearReckoners());

const LIGHT_TIME_SECONDS = 10;

function delayedStore() {
  let now = 0;
  const clock = new ViewClock({
    nowWall: () => now,
    warpRate: () => 1,
    delaySeconds: () => LIGHT_TIME_SECONDS,
  });
  return {
    store: new TimelineStore(clock),
    advanceBy: (seconds: number) => {
      now += seconds;
    },
  };
}

describe("an Uplink's model on a value its contract marks", () => {
  it("reads as declined, with its reason, when it refuses", () => {
    const acme = defineUplinkClient({
      id: "acme-marks",
      version: "1.0.0",
      name: "Acme",
      description: "Models a test Topic and refuses.",
      tags: {
        reckonable: [
          {
            topic: "test.temperature",
            field: "",
            basis: "rate-integration",
            inputs: [],
          },
        ],
      },
    });
    acme.registerReckoner("test.temperature", {
      deps: [],
      reckon: () => ({
        declined: { reason: "model-inapplicable", note: "the heater is off" },
      }),
    });

    const { store, advanceBy } = delayedStore();
    store.ingest("test.temperature", {
      validAt: 100,
      payload: 5,
      meta: makeMeta({ validAt: 100, deliveredAt: 100 + LIGHT_TIME_SECONDS }),
      epoch: 0,
    });
    advanceBy(60);
    store.setTransportConnected(false);
    store.beginFrame();

    expect(store.sampleReading<number>("test.temperature").reckoning).toEqual({
      status: "declined",
      declined: { reason: "model-inapplicable", note: "the heater is off" },
    });
  });

  it("is refused at registration when the contract marks nothing", () => {
    const bare = defineUplinkClient({
      id: "acme-unmarked",
      version: "1.0.0",
      name: "Acme",
      description: "Declares no marks.",
    });
    expect(() =>
      bare.registerReckoner("test.temperature", {
        deps: [],
        reckon: () => ({ declined: { reason: "model-inapplicable" } }),
      }),
    ).toThrow(/test\.temperature.*"acme-unmarked".*SitrepReckonable/s);
  });
});
