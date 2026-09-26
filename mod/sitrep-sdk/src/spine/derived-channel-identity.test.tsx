// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { Quality } from "../__generated__/contract";
import { act, render, screen, setupStreamFixture } from "../testing";
import { PRODUCTION_DERIVED_CHANNELS } from "./context";
import { useStream } from "./use-stream";

const UPLINKS = {
  coreContractMajor: 3,
  coreContractMinor: 1,
  uplinks: [
    {
      id: "kos",
      version: "1.0.0",
      available: true,
      contractMajor: 3,
      contractMinor: 1,
      ownedPrefixes: ["kos."],
      health: {
        state: 0,
        detail: null,
        facts: [{ label: "cpus", value: "2" }],
      },
    },
  ],
};

/**
 * Wire-shaped inputs that make each production derived channel answer a whole
 * record. Keyed by channel topic so a channel added to the production list
 * without an entry here fails below rather than going unchecked.
 */
const INPUTS: Record<string, Record<string, unknown>> = {
  "system.state": {
    "system.bodies": {
      bodies: [
        {
          name: "Kerbin",
          index: 1,
          parentIndex: 0,
          radius: 600_000,
          orbit: null,
        },
      ],
    },
  },
  "system.uplinkHealth": {
    "system.uplinks": UPLINKS,
  },
  "spaceCenter.state": {
    "spaceCenter.launchSites": [
      { padOccupied: true, padVesselTitle: "Kerbal X" },
      { padOccupied: null, padVesselTitle: null },
    ],
  },
  "dv.currentStageResource": {
    "dv.stages": [
      { stage: 0, resources: { LiquidFuel: { current: 90, max: 180 } } },
    ],
    "vessel.structure": { currentStage: 0 },
  },
  "dv.currentStageResourceMax": {
    "dv.stages": [
      { stage: 0, resources: { LiquidFuel: { current: 90, max: 180 } } },
    ],
    "vessel.structure": { currentStage: 0 },
  },
};

function streamFor(topic: string) {
  const inputs = INPUTS[topic];
  if (!inputs) {
    throw new Error(`no wire inputs for derived channel ${topic}`);
  }
  const stream = setupStreamFixture({
    carriedChannels: [topic, ...Object.keys(inputs)],
  });
  const feed = () => {
    for (const [input, payload] of Object.entries(inputs)) {
      stream.subscribe(input);
      stream.emit(input, payload, {
        quality: Quality.OnRails,
        source: "vessel:1",
        validAt: 100,
        deliveredAt: 100,
      });
    }
  };
  return { ...stream, feed };
}

/** A store fed straight off the client, with no provider mounted. */
function streamWith(topic: string) {
  const stream = streamFor(topic);
  stream.client.attachStore(stream.store);
  stream.feed();
  return stream;
}

describe("a derived channel keeps its identity across frames nothing changed in", () => {
  it.each(
    PRODUCTION_DERIVED_CHANNELS.map((c) => c.topic),
  )("%s answers the same payload on an idle frame", (topic) => {
    const { store } = streamWith(topic);

    const first = store.sample(topic, store.beginFrame());
    const second = store.sample(topic, store.beginFrame());

    expect(first?.payload).toBeTypeOf("object");
    expect(first?.payload).not.toBeNull();
    expect(second).toBe(first);
    expect(store.sampleReading(topic)).toBe(store.sampleReading(topic));
  });

  it("keeps a record whose inputs held while the view time advanced", () => {
    const { store, wall } = streamWith("spaceCenter.state");

    const first = store.sample("spaceCenter.state", store.beginFrame());
    wall.advanceBy(1);
    const second = store.sample("spaceCenter.state", store.beginFrame());

    expect(second).toBe(first);
    expect(first?.payload).toEqual({
      padOccupied: true,
      padVesselTitle: "Kerbal X",
    });
  });

  it("answers a new payload once an input really changes", () => {
    const stream = streamWith("spaceCenter.state");
    const { store } = stream;

    const first = store.sample("spaceCenter.state", store.beginFrame());
    stream.emit(
      "spaceCenter.launchSites",
      [{ padOccupied: false, padVesselTitle: null }],
      { validAt: 101, deliveredAt: 101 },
    );
    const second = store.sample("spaceCenter.state", store.beginFrame());

    expect(second).not.toBe(first);
    expect(second?.payload).toEqual({
      padOccupied: false,
      padVesselTitle: null,
    });
  });

  it("keeps an unchanged branch of a record when a sibling branch moves", () => {
    const stream = streamWith("system.uplinkHealth");
    const { store } = stream;
    const topic = "system.uplinkHealth";

    const first = store.sample<{ uplinks: unknown[] }>(
      topic,
      store.beginFrame(),
    );
    stream.emit(
      "system.uplinks",
      { ...UPLINKS, coreContractMinor: 2 },
      { validAt: 101, deliveredAt: 101 },
    );
    const second = store.sample<{ uplinks: unknown[] }>(
      topic,
      store.beginFrame(),
    );

    expect(second?.payload).not.toBe(first?.payload);
    expect(second?.payload?.uplinks).toBe(first?.payload?.uplinks);
  });
});

describe("a component reading a derived topic", () => {
  it("does not re-render on frames where the record did not change", () => {
    const stream = streamFor("spaceCenter.state");
    let renders = 0;

    function PadStatus() {
      renders++;
      const reading = useStream<{ padVesselTitle: string | null }>(
        "spaceCenter.state",
      );
      return (
        <output>
          {reading.state === "observed" ? reading.value.padVesselTitle : "none"}
        </output>
      );
    }

    render(
      <stream.Provider>
        <PadStatus />
      </stream.Provider>,
    );
    act(() => {
      stream.feed();
      stream.store.beginFrame();
    });
    expect(screen.getByRole("status").textContent).toBe("Kerbal X");
    const settled = renders;

    const idleFrames = 30;
    for (let i = 0; i < idleFrames; i++) {
      act(() => {
        stream.wall.advanceBy(1 / 60);
        stream.store.beginFrame();
      });
    }

    expect(renders - settled).toBe(0);
  });
});
