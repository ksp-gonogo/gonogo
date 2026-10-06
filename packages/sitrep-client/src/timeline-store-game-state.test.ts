import { parseServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client";
import { makeMeta } from "./stub-transport";
import { systemStateChannel } from "./system-state";
import type { TimelinePoint } from "./timeline";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function point(validAt: number, payload: unknown): TimelinePoint<unknown> {
  return {
    validAt,
    payload,
    meta: makeMeta({ validAt, deliveredAt: validAt }),
    epoch: 0,
  };
}

function store(): TimelineStore {
  const s = new TimelineStore(
    new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
  );
  s.registerDerivedChannel(systemStateChannel);
  return s;
}

const BODIES = { bodies: [{ name: "Kerbin", index: 1 }] };

describe("the game's own state, held on the store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds an observed topic with the grade loading once a load has run 750 ms", () => {
    const s = store();
    s.ingest("system.bodies", point(10, BODIES));
    s.beginFrame();
    expect(s.sampleReading("system.bodies").state).toBe("observed");

    s.setGameState("loading", "FLIGHT");
    vi.advanceTimersByTime(749);
    expect(s.sampleReading("system.bodies").state).toBe("observed");

    vi.advanceTimersByTime(1);
    const held = s.sampleReading("system.bodies");
    expect(held.state).toBe("held");
    expect(held.state === "held" && held.grade).toBe("loading");
  });

  it("reads observed again at once when the game is ready", () => {
    const s = store();
    s.ingest("system.bodies", point(10, BODIES));
    s.setGameState("loading", "FLIGHT");
    vi.advanceTimersByTime(800);
    expect(s.sampleReading("system.bodies").state).toBe("held");

    s.setGameState("ready", "FLIGHT");

    expect(s.sampleReading("system.bodies").state).toBe("observed");
  });

  it("changes no reading for a load that ends inside the onset", () => {
    const s = store();
    s.ingest("system.bodies", point(10, BODIES));
    s.beginFrame();
    const before = s.sampleReading("system.bodies");

    s.setGameState("loading", "SPACECENTER");
    vi.advanceTimersByTime(300);
    s.setGameState("ready", "SPACECENTER");
    vi.advanceTimersByTime(2000);

    expect(s.sampleReading("system.bodies")).toBe(before);
    expect(s.gameStatus().state).toBe("ready");
  });

  it("leaves a topic that never had a value pending", () => {
    const s = store();
    s.setGameState("loading", "FLIGHT");
    vi.advanceTimersByTime(800);

    expect(s.sampleReading("system.bodies").state).toBe("pending");
  });

  it("makes a derived channel inherit the grade", () => {
    const s = store();
    s.ingest("system.bodies", point(10, BODIES));
    s.setGameState("loading", "FLIGHT");
    vi.advanceTimersByTime(800);

    expect(s.sampleStatus("system.state")).toBe("loading");
  });

  it("holds every reading at once, with no onset, when there is no game", () => {
    const s = store();
    s.ingest("system.bodies", point(10, BODIES));

    s.setGameState("no-game", "MAINMENU");

    const held = s.sampleReading("system.bodies");
    expect(held.state === "held" && held.grade).toBe("no-game");
    expect(s.gameStatus()).toEqual({ state: "no-game", scene: "MAINMENU" });
  });

  it("says a load only after the onset, and tells a listener when it does", () => {
    const s = store();
    const heard: string[] = [];
    s.subscribeGameStatus(() => heard.push(s.gameStatus().state));

    s.setGameState("loading", "EDITOR");
    expect(s.gameStatus()).toEqual({ state: "ready", scene: "" });
    expect(heard).toEqual([]);

    vi.advanceTimersByTime(750);
    expect(s.gameStatus()).toEqual({ state: "loading", scene: "EDITOR" });
    expect(heard).toEqual(["loading"]);

    s.setGameState("ready", "EDITOR");
    expect(heard).toEqual(["loading", "ready"]);
  });

  it("restarts the onset when a second load replaces the first", () => {
    const s = store();
    s.setGameState("loading", "FLIGHT");
    vi.advanceTimersByTime(500);
    s.setGameState("loading", "SPACECENTER");
    vi.advanceTimersByTime(500);
    expect(s.gameStatus().state).toBe("ready");

    vi.advanceTimersByTime(250);
    expect(s.gameStatus()).toEqual({ state: "loading", scene: "SPACECENTER" });
  });

  it("treats a state it does not know as ready", () => {
    const s = store();
    s.setGameState("loading", "FLIGHT");
    vi.advanceTimersByTime(800);

    s.setGameState("something-new", "FLIGHT");

    expect(s.gameStatus().state).toBe("ready");
  });
});

describe("a game-state frame", () => {
  it("is read as a server message", () => {
    const message = parseServerMessage(
      '{"type":"game-state","state":"loading","scene":"FLIGHT"}',
    );

    expect(message).toEqual({
      type: "game-state",
      state: "loading",
      scene: "FLIGHT",
    });
  });
});

describe("a client carrying the game's state to its stores", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tells a store attached before the frame, and one attached after it", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const early = store();
    client.attachStore(early);

    transport.emitRaw({
      type: "game-state",
      state: "loading",
      scene: "FLIGHT",
    });
    const late = store();
    client.attachStore(late);
    vi.advanceTimersByTime(750);

    expect(early.gameStatus()).toEqual({ state: "loading", scene: "FLIGHT" });
    expect(late.gameStatus()).toEqual({ state: "loading", scene: "FLIGHT" });
  });
});
