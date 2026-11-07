import { describe, expect, it } from "vitest";
import type { StreamData } from "../__generated__/contract";
import { StubTransport } from "../testing/stub-transport";
import { TelemetryClient } from "./client";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

const TOPIC = "v.alt";
const SECONDS = 1400;

let wallMs = 0;

function newStore(): TimelineStore {
  return new TimelineStore(
    new ViewClock({
      nowWall: () => wallMs,
      warpRate: () => 1,
      delaySeconds: () => 0,
    }),
  );
}

/** A station's link to the main screen: history is answered from the main screen's own store, as the relay answers it over PeerJS. */
class RelayedTransport extends StubTransport {
  requests: Array<{ fromUt: number; toUt: number }> = [];

  constructor(private readonly main: TimelineStore) {
    super();
  }

  async requestHistory(
    topic: string,
    fromUt: number,
    toUt: number,
  ): Promise<StreamData<unknown>[]> {
    this.requests.push({ fromUt, toUt });
    return (this.main.sampleRange<unknown>(topic, fromUt, toUt) ?? []).map(
      (point) => ({
        type: "stream-data",
        topic,
        payload: point.payload,
        meta: point.meta,
      }),
    );
  }
}

function setup() {
  wallMs = 0;
  const mainTransport = new StubTransport();
  const mainClient = new TelemetryClient(mainTransport);
  const main = newStore();
  mainClient.attachStore(main);
  mainClient.subscribe(TOPIC, () => {});

  const stationTransport = new RelayedTransport(main);
  const stationClient = new TelemetryClient(stationTransport);
  const station = newStore();
  stationClient.attachStore(station);
  stationClient.subscribe(TOPIC, () => {});

  const run = (from: number, to: number) => {
    for (let ut = from; ut < to; ut++) {
      wallMs = ut * 1000;
      const meta = { validAt: ut, deliveredAt: ut * 1000, seq: ut };
      mainTransport.emit(TOPIC, ut, meta);
      stationTransport.emit(TOPIC, ut, meta);
    }
  };
  return { main, station, stationTransport, run };
}

describe("a station's held telemetry", () => {
  it("stays bounded over a long run while the main screen keeps every point", () => {
    const { main, station, run } = setup();
    const release = station.holdWindow(TOPIC, 60);

    run(0, SECONDS / 2);
    const midway = station.heldPointCount();
    run(SECONDS / 2, SECONDS);

    expect(main.heldPointCount()).toBe(SECONDS);
    expect(station.heldPointCount()).toBeLessThanOrEqual(80);
    expect(station.heldPointCount()).toBeLessThanOrEqual(midway + 1);
    release();
  });

  it("asks the main screen for older points when a chart scrolls back, and lets them go again after", async () => {
    const { station, stationTransport, run } = setup();
    const releaseSmall = station.holdWindow(TOPIC, 60);
    run(0, SECONDS);

    const releaseWide = station.holdWindow(TOPIC, 600);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const scrollBack = stationTransport.requests.at(-1);
    expect(scrollBack?.fromUt).toBeLessThanOrEqual(SECONDS - 600);
    expect(scrollBack?.toUt).toBeGreaterThan(SECONDS - 100);
    const fetched = station.sampleRange<number>(TOPIC, SECONDS - 600, SECONDS);
    expect(fetched?.length).toBeGreaterThanOrEqual(595);

    releaseWide();
    run(SECONDS, SECONDS + 1);
    expect(station.heldPointCount()).toBeLessThanOrEqual(80);
    releaseSmall();
  });
});
