import { logger } from "@ksp-gonogo/logger";
import { type TopicId, unitOf, value, WarpMode } from "@ksp-gonogo/sitrep-sdk";
import { ws } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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

  /**
   * The verdict is judged from the log, so a log that records nothing must stop
   * the run rather than hand the classifier an empty buffer it would read as a
   * quiet session. Planted here by making every shadow line land nowhere.
   */
  it("refuses a verdict when alarms fired and the log recorded nothing", async () => {
    serveFlight(() => 250_000);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});

    await expect(
      runShadowAcceptance({ host: "localhost", port: PORT, observeMs: 2000 }),
    ).rejects.toThrow(/recorded no alarm-shadow line/);
    warn.mockRestore();
    info.mockRestore();
  });

  it("records the shadow lines it is judged from, and leaves the logger as it found it", async () => {
    serveFlight(() => 250_000);
    logger.setEnabled(false);

    const { verdict } = await runShadowAcceptance({
      host: "localhost",
      port: PORT,
      observeMs: 2000,
    });

    expect(verdict.verdict).not.toBeUndefined();
    expect(logger.isEnabled()).toBe(false);
    expect(
      logger
        .snapshot()
        .some((entry) => entry.message.includes("client fired, mod has not")),
    ).toBe(true);
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

describe("runShadowAcceptance: the warp hold", () => {
  it("puts the rung back when the game has dropped below it", async () => {
    const sent: SentCommand[] = [];
    serveWarpGame(sent);

    const { warpReapplies, warpUnread } = await runShadowAcceptance({
      host: "localhost",
      port: PORT,
      observeMs: 2500,
      warpIndex: 3,
    });

    expect(warpUnread).toBe(false);
    expect(warpReapplies).toBeGreaterThan(0);
    expect(warpCommands(sent)).toContainEqual({ index: 3 });
  });

  it("says it never read the rung, rather than reporting a quiet zero", async () => {
    serveDelay(null);
    serveWarpGame([], { reportsWarp: false });

    const { warpReapplies, warpUnread } = await runShadowAcceptance({
      host: "localhost",
      port: PORT,
      observeMs: 2500,
      warpIndex: 3,
    });

    expect(warpReapplies).toBe(0);
    expect(warpUnread).toBe(true);
  });
});

interface SentCommand {
  command: string;
  args: unknown;
}

/**
 * A game sitting at rung 0, as it does after the mod cancels warp, that records
 * every command with its arguments and answers each one: `"confirm"` as a
 * success, `"refuse"` as the game saying no. `reportsWarp: false` answers the
 * commands and never the `time.warp` subscription.
 */
function serveWarpGame(
  sent: SentCommand[],
  {
    answer = "confirm",
    reportsWarp = true,
  }: { answer?: "confirm" | "refuse"; reportsWarp?: boolean } = {},
): void {
  server.use(
    link.addEventListener(
      "connection",
      ({ client }: { client: LinkClient }) => {
        client.addEventListener("message", (event) => {
          const msg: unknown = JSON.parse(String(event.data));
          if (typeof msg !== "object" || msg === null || !("type" in msg)) {
            return;
          }
          if (msg.type === "command-request") {
            sent.push({
              command: "command" in msg ? String(msg.command) : "",
              args: "args" in msg ? msg.args : undefined,
            });
            client.send(
              JSON.stringify({
                type: "command-response",
                requestId: "requestId" in msg ? msg.requestId : undefined,
                result:
                  answer === "confirm"
                    ? { success: true, errorCode: 0 }
                    : { success: false, errorCode: 13, detail: "not now" },
                meta: JSON.parse(streamFrame("x", null)).meta,
              }),
            );
          }
          if (
            reportsWarp &&
            msg.type === "subscribe" &&
            "topic" in msg &&
            msg.topic === "time.warp"
          ) {
            client.send(
              streamFrame("time.warp", {
                warpRate: 1,
                warpRateIndex: 0,
                warpRates: [1, 5, 10, 50, 100, 1000, 10000, 100000],
                warpMode: WarpMode.High,
                paused: false,
              }),
            );
          }
        });
      },
    ),
  );
}

const warpCommands = (sent: SentCommand[]) =>
  sent.filter((c) => c.command === "time.setWarpIndex").map((c) => c.args);

/*
 * Every exit path, because the one that skips the release is always the one
 * nobody tests: a run that only let go of warp on success would pass the first
 * case here and leave the game warping on every other.
 */
describe("runShadowAcceptance: warp goes back to 1x however the run ends", () => {
  it("after a run that finishes", async () => {
    const sent: SentCommand[] = [];
    serveWarpGame(sent);

    await runShadowAcceptance({
      host: "localhost",
      port: PORT,
      observeMs: 2500,
      warpIndex: 3,
    });

    expect(warpCommands(sent)).toContainEqual({ index: 3 });
    expect(warpCommands(sent).at(-1)).toEqual({ index: 0 });
  });

  it("after a run that throws", async () => {
    const sent: SentCommand[] = [];
    serveWarpGame(sent);
    serveFlight(() => 250_000);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});

    await expect(
      runShadowAcceptance({
        host: "localhost",
        port: PORT,
        observeMs: 2500,
        warpIndex: 3,
      }),
    ).rejects.toThrow(/recorded no alarm-shadow line/);
    warn.mockRestore();
    info.mockRestore();

    expect(warpCommands(sent)).toContainEqual({ index: 3 });
    expect(warpCommands(sent).at(-1)).toEqual({ index: 0 });
  });

  it("after a run that is interrupted", async () => {
    const sent: SentCommand[] = [];
    serveWarpGame(sent);
    const interrupt = new AbortController();
    setTimeout(() => interrupt.abort("SIGINT"), 2500);

    await expect(
      runShadowAcceptance({
        host: "localhost",
        port: PORT,
        observeMs: 600_000,
        warpIndex: 3,
        signal: interrupt.signal,
      }),
    ).rejects.toThrow("the run was interrupted: SIGINT");

    expect(warpCommands(sent)).toContainEqual({ index: 3 });
    expect(warpCommands(sent).at(-1)).toEqual({ index: 0 });
  });

  it("fails a finished run the game would not let go of warp for", async () => {
    const sent: SentCommand[] = [];
    serveWarpGame(sent, { answer: "refuse" });

    await expect(
      runShadowAcceptance({
        host: "localhost",
        port: PORT,
        observeMs: 500,
        warpIndex: 3,
      }),
    ).rejects.toThrow(
      /held warp at rung 3 and could not return it to 1x: the game refused it/,
    );
  });

  it("leaves warp alone when the run was given no rung to hold", async () => {
    const sent: SentCommand[] = [];
    serveWarpGame(sent);

    await runShadowAcceptance({
      host: "localhost",
      port: PORT,
      observeMs: 500,
    });

    expect(warpCommands(sent)).toEqual([]);
  });
});

/**
 * The mod still holding an alarm from an earlier run against the same game: it
 * answers the run's `alarm.scet.fired` subscription with a fire for an id this
 * run never armed.
 */
function serveStrangerFire(): void {
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
            msg.topic === "alarm.scet.fired"
          ) {
            client.send(
              streamFrame("alarm.scet.fired", {
                id: "left-by-an-earlier-run",
                firedAtUt: 5,
                vantage: "",
              }),
            );
          }
        });
      },
    ),
  );
}

describe("runShadowAcceptance: alarms it never armed", () => {
  it("sets aside a mod fire for an alarm an earlier run left behind, and names it", async () => {
    serveStrangerFire();

    const { verdict } = await runShadowAcceptance({
      host: "localhost",
      port: PORT,
      observeMs: 500,
    });

    expect(verdict.outcomes["one-sided"]).toBe(0);
    expect(verdict.excluded.flatMap((x) => x.fires.map((f) => f.id))).toEqual([
      "left-by-an-earlier-run",
    ]);
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
