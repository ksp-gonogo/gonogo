import { type TopicId, unitOf, value } from "@ksp-gonogo/sitrep-sdk";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { LinkClient } from "../test/peerFakes";
import {
  reportedOneWay,
  runShadowAcceptance,
  SHADOW_ACCEPTANCE_ALARMS,
} from "./shadowAcceptanceRun";

/**
 * The acceptance run against a stream whose delay is known, so a harness that
 * cannot see delay fails here rather than reporting a clean zero off a real
 * link. The wire carries `oneWaySeconds` as a bare number, exactly as the mod
 * sends it; the decode wraps it, and the run has to read the wrapped form.
 */

const PORT = 8097;
const link = ws.link(`ws://localhost:${PORT}`);
const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function streamFrame(topic: string, payload: unknown): string {
  return JSON.stringify({
    type: "stream-data",
    topic,
    payload,
    meta: {
      source: "test",
      validAt: 1,
      seq: 0,
      deliveredAt: 1,
      vantage: "test",
      quality: 0,
      active: false,
      staleness: 0,
      timelineEpoch: 0,
    },
  });
}

/** Answers the run's `comms.delay` subscription with `oneWaySeconds`. */
function serveDelay(oneWaySeconds: number | null): void {
  server.use(
    link.addEventListener(
      "connection",
      ({ client }: { client: LinkClient }) => {
        client.addEventListener("message", (event) => {
          const msg: unknown = JSON.parse(String(event.data));
          if (
            typeof msg === "object" &&
            msg !== null &&
            "type" in msg &&
            msg.type === "subscribe" &&
            "topic" in msg &&
            msg.topic === "comms.delay"
          ) {
            client.send(
              streamFrame("comms.delay", {
                oneWaySeconds,
                source: oneWaySeconds === null ? "None" : "SignalDelay",
              }),
            );
          }
        });
      },
    ),
  );
}

describe("runShadowAcceptance: the delay it reports is the link's", () => {
  it("reports a planted 2.675 s one-way delay, not zero", async () => {
    serveDelay(2.675);

    const { owlt, verdict } = await runShadowAcceptance({
      host: "localhost",
      port: PORT,
      observeMs: 500,
    });

    expect(owlt?.toJSON()).toEqual({ magnitude: 2.675, unit: "s" });
    expect(verdict.reason).not.toMatch(/no one-way delay/);
  });

  it("reports no delay when the link has none to measure", async () => {
    serveDelay(null);

    const { owlt, verdict } = await runShadowAcceptance({
      host: "localhost",
      port: PORT,
      observeMs: 500,
    });

    expect(owlt).toBeNull();
    expect(verdict.verdict).toBe("INCONCLUSIVE");
    expect(verdict.reason).toMatch(/no one-way delay/);
  });
});

/**
 * Streams `vessel.flight` every 200 ms of wall time, 0.2 s of game time apart,
 * with the altitude `altitudeAt(sample)` returns and no orbital speed, so the
 * speed alarm has nothing to read.
 */
function serveFlight(altitudeAt: (sample: number) => number): void {
  server.use(
    link.addEventListener(
      "connection",
      ({ client }: { client: LinkClient }) => {
        let sample = 0;
        const timer = setInterval(() => {
          const frame = JSON.parse(
            streamFrame("vessel.flight", { altitudeAsl: altitudeAt(sample) }),
          );
          frame.meta.validAt = 10_000 + sample * 0.2;
          frame.meta.deliveredAt = frame.meta.validAt;
          frame.meta.seq = sample;
          client.send(JSON.stringify(frame));
          sample++;
        }, 200);
        client.addEventListener("close", () => clearInterval(timer));
      },
    ),
  );
}

describe("runShadowAcceptance: its thresholds read the stream", () => {
  it("fires an alarm armed while its condition already holds", async () => {
    serveFlight(() => 250_000);

    const { finalStates, unread } = await runShadowAcceptance({
      host: "localhost",
      port: PORT,
      observeMs: 2000,
    });

    expect(finalStates["Altitude 200 km"]).toBe("firing");
    expect(finalStates["Altitude 300 km"]).toBe("pending");
    expect(unread).not.toContain("Altitude 200 km");
  });

  it("fires on a crossing that lands between two samples", async () => {
    serveFlight((sample) => (sample < 4 ? 150_000 : 250_000));

    const { finalStates } = await runShadowAcceptance({
      host: "localhost",
      port: PORT,
      observeMs: 2500,
    });

    expect(finalStates["Altitude 200 km"]).toBe("firing");
  });

  it("names an alarm whose reading never resolved, which looks exactly like one not yet true", async () => {
    serveFlight(() => 250_000);

    const { finalStates, unread } = await runShadowAcceptance({
      host: "localhost",
      port: PORT,
      observeMs: 2000,
    });

    expect(finalStates["Speed 2 km/s"]).toBe("pending");
    expect(finalStates["Altitude 300 km"]).toBe("pending");
    expect(unread).toEqual(["Speed 2 km/s"]);
  });
});

describe("reportedOneWay", () => {
  it("reads the decoded seconds value", () => {
    expect(
      reportedOneWay({ oneWaySeconds: value("s", 2.675) })?.toJSON(),
    ).toEqual({ magnitude: 2.675, unit: "s" });
  });

  it("keeps a measured zero as zero", () => {
    expect(reportedOneWay({ oneWaySeconds: value("s", 0) })?.toJSON()).toEqual({
      magnitude: 0,
      unit: "s",
    });
  });

  it.each<[string, unknown]>([
    ["no payload", undefined],
    ["a null reading", { oneWaySeconds: null }],
    ["a bare number", { oneWaySeconds: 2.675 }],
    ["a non-finite reading", { oneWaySeconds: value("s", Number.NaN) }],
    ["a negative reading", { oneWaySeconds: value("s", -1) }],
    ["a reading in another unit", { oneWaySeconds: value("m", 3) }],
  ])("returns null for %s", (_label, payload) => {
    expect(reportedOneWay(payload)).toBeNull();
  });
});

/**
 * A threshold naming a field the wire does not carry is never read, and a run
 * reports it only as an alarm that stayed unread whatever the orbit did. So
 * every armed field is held to the contract's own declaration of its Topic.
 */
describe("the shadow-acceptance alarms", () => {
  it.each(
    SHADOW_ACCEPTANCE_ALARMS.map((a) => [a.name, a] as const),
  )("%s names a field the wire carries", (_, alarm) => {
    expect(unitOf(alarm.topic as TopicId, alarm.fieldPath)).toBeDefined();
    expect(alarm.dataKey).toBe(`${alarm.topic}.${alarm.fieldPath}`);
  });
});
