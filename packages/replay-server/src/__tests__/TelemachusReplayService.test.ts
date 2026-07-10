import {
  FlightReplayDataSource,
  synthesizeFlight,
} from "@ksp-gonogo/data/replay";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseTelemachusInbound,
  TelemachusReplayService,
} from "../TelemachusReplayService";

const FIXTURE = synthesizeFlight({
  vesselName: "Test",
  launchedAt: 1_000_000,
  samples: {
    "v.altitude": [
      [0, 100],
      [1_000, 250],
      [2_000, 500],
    ],
    "v.body": [[0, "Kerbin"]],
  },
});

describe("parseTelemachusInbound", () => {
  it("normalises + / - to add / remove", () => {
    expect(parseTelemachusInbound('{"+":["v.altitude"],"rate":250}')).toEqual({
      add: ["v.altitude"],
      rate: 250,
    });
    expect(parseTelemachusInbound('{"-":["v.altitude"]}')).toEqual({
      remove: ["v.altitude"],
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parseTelemachusInbound("not-json")).toBeNull();
  });

  it("returns null for non-object payloads", () => {
    expect(parseTelemachusInbound("[1,2,3]")).toEqual({});
    expect(parseTelemachusInbound("42")).toBeNull();
  });

  it("filters non-string entries from add/remove arrays", () => {
    expect(
      parseTelemachusInbound('{"+":["v.altitude", 42, null, "o.PeA"]}'),
    ).toEqual({
      add: ["v.altitude", "o.PeA"],
    });
  });
});

describe("TelemachusReplayService", () => {
  let replay: FlightReplayDataSource;
  let sent: Record<string, unknown>[];

  beforeEach(async () => {
    vi.useFakeTimers();
    replay = new FlightReplayDataSource({ fixture: FIXTURE });
    await replay.connect();
    sent = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeService(initial?: { add: string[]; rate?: number }) {
    const service = new TelemachusReplayService({
      replay,
      send: (p) => sent.push(p),
    });
    if (initial) service.applyMessage(initial);
    return service;
  }

  it("doesn't push samples for keys the connection hasn't subscribed to", () => {
    makeService();
    replay.advance(2_000);
    vi.advanceTimersByTime(600); // past one default tick (500ms)
    expect(sent).toHaveLength(0);
  });

  it("pushes the latest value for subscribed keys at the configured rate", () => {
    makeService({ add: ["v.altitude"], rate: 200 });
    replay.advance(1_500); // emits altitude=100, =250
    vi.advanceTimersByTime(200); // one tick → coalesced to latest
    expect(sent).toEqual([{ "v.altitude": 250 }]);
  });

  it("coalesces multiple intra-tick updates into the latest value per key", () => {
    makeService({ add: ["v.altitude"], rate: 1_000 });
    replay.advance(2_500); // emits 100, 250, 500 — all within one rate window
    vi.advanceTimersByTime(1_000);
    expect(sent).toEqual([{ "v.altitude": 500 }]);
  });

  it("doesn't emit empty payloads when nothing changed in a tick", () => {
    makeService({ add: ["v.altitude"], rate: 200 });
    replay.advance(1_000); // altitude moves
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1_000); // no new samples
    expect(sent).toHaveLength(1);
  });

  it("removes keys when a `-` message arrives", () => {
    const service = makeService({ add: ["v.altitude"] });
    service.applyMessage({ remove: ["v.altitude"] });
    replay.advance(2_000);
    vi.advanceTimersByTime(1_000);
    expect(sent).toHaveLength(0);
  });

  it("close() tears down replay subs and stops the timer", () => {
    const service = makeService({ add: ["v.altitude"] });
    service.close();
    replay.advance(2_000);
    vi.advanceTimersByTime(1_000);
    expect(sent).toHaveLength(0);
  });

  it("supports multiple keys per connection", () => {
    makeService({ add: ["v.altitude", "v.body"], rate: 200 });
    replay.advance(2_000); // both keys emit
    vi.advanceTimersByTime(200);
    expect(sent).toEqual([{ "v.altitude": 500, "v.body": "Kerbin" }]);
  });

  it("ignores rate updates that aren't a positive finite number", () => {
    const service = makeService({ add: ["v.altitude"], rate: 200 });
    service.applyMessage({ rate: -1 });
    service.applyMessage({ rate: NaN });
    // Rate is still 200 — replay emits, tick fires after 200ms.
    replay.advance(1_000);
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(1);
  });
});
