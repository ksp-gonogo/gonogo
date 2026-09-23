import { value } from "@ksp-gonogo/sitrep-sdk";
import { ws } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { LinkClient } from "../test/peerFakes";
import { reportedOneWay, runShadowAcceptance } from "./shadowAcceptanceRun";

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
