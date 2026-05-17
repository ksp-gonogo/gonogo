#!/usr/bin/env node
/**
 * Fake Telemachus Reborn WebSocket server for multi-screen Playwright
 * tests. Replays the *final state* of a recorded FlightFixture to any
 * client that connects, so a real `<TelemachusDataSource>` in a real
 * Chromium tab can drive its dashboard widgets without needing KSP
 * running.
 *
 * Snapshot model (chosen over timed playback after the first version):
 *   - At startup, pre-compute the LAST sample value for every key in
 *     the fixture. This is the "as of end of recording" view.
 *   - On each WebSocket subscribe message, immediately send a single
 *     JSON frame containing the latest value for every key the client
 *     is currently subscribed to.
 *   - Then poll: every 250ms re-send the same snapshot to every open
 *     client. This mimics real Telemachus Reborn (which streams the
 *     current values of subscribed keys every `rate` ms regardless of
 *     whether they've changed), and crucially covers the race where
 *     BufferedDataSource subscribes to its upstream after the very
 *     first frame has already been delivered — the next 250ms tick
 *     re-delivers values to the late subscriber.
 *
 * Why snapshot, not timed playback:
 *   - Earlier draft walked cursors forward at 50× wall-clock and
 *     emitted frames every 100ms. Cursors lived in module-scope state,
 *     so repeat runs of the same spec (e.g. `--ui` re-runs, or
 *     reuseExistingServer leaving the process up between invocations)
 *     would find cursors stuck at `replayDone = true` and never emit
 *     fresh frames. The "first run passes, second fails" symptom.
 *   - Tests asserting "main and station see matching telemetry" don't
 *     need to observe time-varying values — they just need every
 *     subscriber to see the same canonical value. Snapshot delivers
 *     that with no statefulness.
 *
 * Protocol contract (matches the real Telemachus Reborn):
 *   - Client subscribes by sending a JSON message:
 *       { "+": ["v.altitude", ...], "rate": 250 }   add subscriptions
 *       { "-": ["v.altitude"] }                     remove
 *       { "run": [...keys], rate: N }               replace
 *   - Server emits frames as JSON objects:
 *       { "v.altitude": 12345.6, "v.body": "Kerbin", ... }
 *
 * Endpoint shape: ws://localhost:<port>/datalink — matches what the
 * gonogo TelemachusDataSource expects when its config is
 * { host: "localhost", port: 8086 }. Tests seed localStorage with that
 * config before page navigation.
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number.parseInt(process.env.TELE_REPLAY_PORT ?? "8086", 10);
const FIXTURE_PATH =
  process.env.TELE_REPLAY_FIXTURE ??
  resolve(HERE, "../../test/recorded_fixtures/launch_to_apoapsis_10000.json");

async function loadFixture(path) {
  const raw = await readFile(path, "utf8");
  const fixture = JSON.parse(raw);
  if (fixture?.format !== "gonogo-flight-fixture/v1") {
    throw new Error(
      `[tele-replay] unsupported fixture format: ${fixture?.format}`,
    );
  }
  return fixture;
}

/**
 * Build a Record<key, latestValue> snapshot from a FlightFixture. Each
 * per-key sample series is sorted ascending by `t`, so the last entry
 * is the canonical "end-of-recording" value.
 */
function buildSnapshot(fixture) {
  const snapshot = {};
  for (const [key, samples] of Object.entries(fixture.samples)) {
    if (Array.isArray(samples) && samples.length > 0) {
      const last = samples[samples.length - 1];
      snapshot[key] = last[1];
    }
  }
  return snapshot;
}

const fixture = await loadFixture(FIXTURE_PATH);
const snapshot = buildSnapshot(fixture);

process.stdout.write(
  `[tele-replay] fixture ${fixture.flight.vesselName} loaded — ` +
    `${Object.keys(snapshot).length} keys (snapshot model)\n`,
);

function parseSubscribeMessage(text) {
  try {
    const data = JSON.parse(text);
    if (typeof data !== "object" || data === null) return null;
    return data;
  } catch {
    return null;
  }
}

const http = createServer((req, res) => {
  if (req.url === "/version") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ version: "fake", buildTime: "test" }));
    return;
  }
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok\n");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http, path: "/datalink" });

let connectCount = 0;

function buildFrame(subs) {
  const frame = {};
  let any = false;
  for (const key of subs) {
    if (key in snapshot) {
      frame[key] = snapshot[key];
      any = true;
    }
  }
  return any ? frame : null;
}

wss.on("connection", (ws) => {
  connectCount += 1;
  const myId = connectCount;
  process.stdout.write(`[tele-replay] connect (#${myId})\n`);
  const subs = new Set();

  // Periodic re-emit, mirroring Telemachus Reborn's `rate` behaviour.
  // Late subscribers (e.g. BufferedDataSource wiring upstream after an
  // async IDB hydrate) catch the next tick instead of the dropped
  // first-frame.
  const ticker = setInterval(() => {
    if (subs.size === 0 || ws.readyState !== ws.OPEN) return;
    const frame = buildFrame(subs);
    if (frame) ws.send(JSON.stringify(frame));
  }, 250);

  ws.on("message", (raw) => {
    const text = raw.toString("utf8");
    const data = parseSubscribeMessage(text);
    process.stdout.write(
      `[tele-replay] msg from #${myId}: ${text.slice(0, 120)}${text.length > 120 ? "..." : ""}\n`,
    );
    if (!data) return;
    if (Array.isArray(data["+"])) {
      for (const k of data["+"]) subs.add(k);
    }
    if (Array.isArray(data["-"])) {
      for (const k of data["-"]) subs.delete(k);
    }
    if (Array.isArray(data.run)) {
      subs.clear();
      for (const k of data.run) subs.add(k);
    }
    if (subs.size === 0) return;
    const frame = buildFrame(subs);
    if (frame && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(frame));
      process.stdout.write(
        `[tele-replay] sent frame to #${myId}: ${Object.keys(frame).length} keys (v.body=${JSON.stringify(frame["v.body"])})\n`,
      );
    } else {
      process.stdout.write(
        `[tele-replay] no frame sent — frame=${frame ? "obj" : "null"}, subs.size=${subs.size}\n`,
      );
    }
  });

  ws.on("close", () => {
    clearInterval(ticker);
    process.stdout.write(`[tele-replay] disconnect (was #${myId})\n`);
  });
});

http.listen(PORT, () => {
  process.stdout.write(
    `[tele-replay] listening on ws://localhost:${PORT}/datalink (snapshot model)\n`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    process.stdout.write(`[tele-replay] received ${sig}, shutting down\n`);
    http.close(() => process.exit(0));
  });
}
