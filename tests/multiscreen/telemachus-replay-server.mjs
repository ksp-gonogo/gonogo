#!/usr/bin/env node
/**
 * Fake Telemachus Reborn WebSocket server for multi-screen Playwright
 * tests. Replays a recorded FlightFixture against any client that
 * connects, so a real `<TelemachusDataSource>` in a real Chromium tab
 * can drive its dashboard widgets without needing KSP running.
 *
 * Protocol contract (matches the real Telemachus Reborn):
 *   - Client subscribes by sending a JSON message:
 *       { "+": ["v.altitude", ...], "rate": 250 }   add subscriptions
 *       { "-": ["v.altitude"] }                     remove
 *       { "run": [...keys], rate: N }               replace
 *     (gonogo uses the "+" form via sendSubscription.)
 *   - Server emits frames as JSON objects:
 *       { "v.altitude": 12345.6, "v.body": "Kerbin", ... }
 *     Only keys with new values since the last frame need to appear,
 *     but full snapshots are fine — clients dedup internally.
 *
 * Replay strategy: walk the fixture's per-key sample timeline in
 * wall-clock-compressed time. Each frame emits the *latest* value for
 * every subscribed key whose sample at-or-before the current cursor
 * time advanced. Time compression is configurable via TELE_REPLAY_RATE
 * (default 50× realtime — a 60s fixture finishes in ~1.2s).
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
const REPLAY_RATE = Number.parseFloat(process.env.TELE_REPLAY_RATE ?? "50");
const FRAME_INTERVAL_MS = Number.parseInt(
  process.env.TELE_REPLAY_FRAME_MS ?? "100",
  10,
);

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
 * Build per-key cursors: each cursor holds the sample list + the
 * index of the latest sample <= current cursor time. Advancing the
 * cursor walks forward in O(advance-count).
 */
function makeCursors(fixture) {
  const cursors = new Map();
  for (const [key, samples] of Object.entries(fixture.samples)) {
    cursors.set(key, { samples, idx: -1, lastEmittedIdx: -1 });
  }
  return cursors;
}

const fixture = await loadFixture(FIXTURE_PATH);
const cursors = makeCursors(fixture);
const fixtureStart = fixture.flight.launchedAt;
const fixtureEnd = fixture.flight.lastSampleAt;
const fixtureDurationMs = fixtureEnd - fixtureStart;

process.stdout.write(
  `[tele-replay] fixture ${fixture.flight.vesselName} loaded — ` +
    `${fixture.flight.sampleCount} samples across ` +
    `${Object.keys(fixture.samples).length} keys over ` +
    `${Math.round(fixtureDurationMs / 1000)}s\n`,
);

/** All currently-connected clients, each with its own subscription set. */
const clients = new Set();

function emitFrame(cursorTimeMs, force = false) {
  const frame = {};
  let any = false;
  for (const [key, cursor] of cursors) {
    // Advance idx to the latest sample at or before cursorTimeMs.
    while (
      cursor.idx + 1 < cursor.samples.length &&
      cursor.samples[cursor.idx + 1][0] <= cursorTimeMs
    ) {
      cursor.idx += 1;
    }
    if (cursor.idx < 0) continue;
    // Emit only when the cursor advanced since last emit, or on force
    // (used at subscribe time to seed the client with the current
    // snapshot).
    if (cursor.idx === cursor.lastEmittedIdx && !force) continue;
    cursor.lastEmittedIdx = cursor.idx;
    frame[key] = cursor.samples[cursor.idx][1];
    any = true;
  }
  if (!any) return;
  const payload = JSON.stringify(frame);
  // Per-client filter: only send keys the client actually subscribed to.
  for (const client of clients) {
    if (client.ws.readyState !== client.ws.OPEN) continue;
    const filtered = {};
    let send = false;
    for (const key of Object.keys(frame)) {
      if (client.subs.has(key)) {
        filtered[key] = frame[key];
        send = true;
      }
    }
    if (send) {
      client.ws.send(JSON.stringify(filtered));
    } else if (client.subs.size === 0) {
      // No subs yet — drop. Avoids flooding the client during the
      // window between connect and subscribe.
    }
  }
  // Suppress unused-var lint when no client matched.
  void payload;
}

let cursorTimeMs = fixtureStart;
let replayInterval = null;
let replayDone = false;

function startReplay() {
  if (replayInterval !== null) return;
  if (replayDone) return;
  replayInterval = setInterval(() => {
    cursorTimeMs += FRAME_INTERVAL_MS * REPLAY_RATE;
    if (cursorTimeMs >= fixtureEnd) {
      cursorTimeMs = fixtureEnd;
      replayDone = true;
      clearInterval(replayInterval);
      replayInterval = null;
      // Final emit at the very end so clients see the terminal state.
      emitFrame(cursorTimeMs, false);
      process.stdout.write("[tele-replay] replay complete\n");
      return;
    }
    emitFrame(cursorTimeMs, false);
  }, FRAME_INTERVAL_MS);
}

function parseSubscribeMessage(text) {
  try {
    const data = JSON.parse(text);
    if (typeof data !== "object" || data === null) return null;
    return data;
  } catch {
    return null;
  }
}

// Plain HTTP server + WebSocket upgrade — matches Telemachus's surface
// shape. The /version probe is handled too so the KosDataSource's
// `refreshRemoteVersion` HTTP probe doesn't 404 (it's not strictly
// needed for the Telemachus path but the test rig may share the port
// if we ever fold the kOS proxy too).
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

wss.on("connection", (ws) => {
  const client = { ws, subs: new Set() };
  clients.add(client);
  process.stdout.write(`[tele-replay] connect (${clients.size} total)\n`);

  ws.on("message", (raw) => {
    const data = parseSubscribeMessage(raw.toString("utf8"));
    if (!data) return;
    if (Array.isArray(data["+"])) {
      for (const k of data["+"]) client.subs.add(k);
    }
    if (Array.isArray(data["-"])) {
      for (const k of data["-"]) client.subs.delete(k);
    }
    if (Array.isArray(data.run)) {
      client.subs.clear();
      for (const k of data.run) client.subs.add(k);
    }
    // Seed the new subscriber with the current snapshot. emitFrame
    // with force=true on first subscribe would re-send the whole
    // history to every client — instead, send a one-shot snapshot
    // just to *this* client.
    if (client.subs.size > 0) {
      const snapshot = {};
      let any = false;
      for (const [key, cursor] of cursors) {
        if (!client.subs.has(key)) continue;
        if (cursor.idx < 0) continue;
        snapshot[key] = cursor.samples[cursor.idx][1];
        any = true;
      }
      if (any && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(snapshot));
      }
    }
    startReplay();
  });

  ws.on("close", () => {
    clients.delete(client);
    process.stdout.write(`[tele-replay] disconnect (${clients.size} total)\n`);
  });
});

http.listen(PORT, () => {
  process.stdout.write(
    `[tele-replay] listening on ws://localhost:${PORT}/datalink (rate=${REPLAY_RATE}× frame=${FRAME_INTERVAL_MS}ms)\n`,
  );
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    process.stdout.write(`[tele-replay] received ${sig}, shutting down\n`);
    if (replayInterval !== null) clearInterval(replayInterval);
    http.close(() => process.exit(0));
  });
}
