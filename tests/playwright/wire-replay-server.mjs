#!/usr/bin/env node
/**
 * The mod, played back from a wire recording (`wire-fixture.mjs`), stepped by
 * the spec rather than by the clock. A main screen pointed at this port reads
 * the recording through its real `WebSocketTransport`, and its stations get it
 * from the main over the real peer path, so what differs between screens is
 * what the app does with one stream and never a difference in what each was
 * sent.
 *
 * It answers a connection as the mod does: the recording's `hello` and current
 * `game-state` on open, and on `subscribe` the recorded `subscribed` ack and the
 * latest frame of that topic delivered so far, stamped as delivered at the
 * replay's current instant (a screen's clock follows `deliveredAt`). A topic the recording never
 * carried is not acknowledged. `ping` gets its `pong`, so a paused replay is a
 * quiet stream and not a dead one.
 *
 * Control, over HTTP on the same port (JSON bodies):
 *
 *   POST /replay/load     { fixture }  path to a .jsonl, relative to the repo
 *                                      root or absolute; drops every connection
 *                                      and rewinds to before the first frame
 *   POST /replay/advance  { toMs }     sends every frame up to `toMs` after
 *                                      the recording's first frame
 *   GET  /replay/state                 { fixture, cursorMs, durationMs, clients }
 */
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { deliveredAt, readWireFixture } from "./wire-fixture.mjs";

const PORT = Number.parseInt(process.env.WIRE_REPLAY_PORT ?? "18098", 10);
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../..");

function isAck(frame) {
  return frame.type === "event" && frame.name === "subscribed";
}

/** Every frame that is about one topic and so goes only to a connection subscribed to it. */
function topicOf(frame) {
  return frame.type === "stream-data" || frame.type === "event"
    ? frame.topic
    : undefined;
}

async function readJson(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text === "" ? {} : JSON.parse(text);
}

export function startWireReplayServer({ port = PORT } = {}) {
  let fixture = null;
  let rows = [];
  /** Index of the next row to send. */
  let next = 0;
  let cursorMs = -1;
  let hello = null;
  let gameState = null;
  /** The latest `meta.deliveredAt` sent: the replay's current instant. */
  let nowUt = 0;
  /** topic -> latest `stream-data` frame sent. */
  const latest = new Map();
  /** topic -> recorded `subscribed` ack. */
  const acks = new Map();
  /** socket -> its subscribed topics. */
  const clients = new Map();

  function send(ws, frame) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  }

  function load(path) {
    for (const ws of clients.keys()) ws.terminate();
    clients.clear();
    fixture = path;
    rows = readWireFixture(resolve(REPO_ROOT, path));
    next = 0;
    cursorMs = -1;
    latest.clear();
    acks.clear();
    hello = rows.find((row) => row.frame.type === "hello")?.frame ?? null;
    gameState = null;
    nowUt = 0;
    for (const { frame } of rows) {
      if (isAck(frame) && !acks.has(frame.topic)) acks.set(frame.topic, frame);
    }
  }

  function advance(toMs) {
    const t0 = rows[0]?.t ?? 0;
    let sent = 0;
    while (next < rows.length && rows[next].t - t0 <= toMs) {
      const { frame } = rows[next];
      next += 1;
      sent += 1;
      if (isAck(frame)) continue;
      if (frame.type === "hello") hello = frame;
      if (frame.type === "game-state") gameState = frame;
      if (frame.type === "stream-data") latest.set(frame.topic, frame);
      nowUt = Math.max(nowUt, frame.meta?.deliveredAt ?? 0);
      const topic = topicOf(frame);
      for (const [ws, topics] of clients) {
        if (topic === undefined || topics.has(topic)) send(ws, frame);
      }
    }
    cursorMs = Math.max(cursorMs, toMs);
    return sent;
  }

  function state() {
    const durationMs = rows.length > 0 ? rows.at(-1).t - rows[0].t : 0;
    return { fixture, cursorMs, durationMs, clients: clients.size };
  }

  const http = createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.url === "/health") return reply(200, { ok: true });
      if (req.url === "/replay/state") return reply(200, state());
      if (req.method === "POST" && req.url === "/replay/load") {
        const { fixture: path } = await readJson(req);
        if (typeof path !== "string") return reply(400, { error: "fixture" });
        load(path);
        return reply(200, state());
      }
      if (req.method === "POST" && req.url === "/replay/advance") {
        const { toMs } = await readJson(req);
        if (typeof toMs !== "number") return reply(400, { error: "toMs" });
        if (fixture === null) return reply(409, { error: "nothing loaded" });
        const sent = advance(toMs);
        return reply(200, { ...state(), sent });
      }
      return reply(404, { error: "not found" });
    } catch (error) {
      return reply(500, { error: String(error) });
    }
  });

  // The mod accepts the socket at its root, as WebSocketTransport expects.
  const wss = new WebSocketServer({ server: http });
  wss.on("connection", (ws) => {
    const topics = new Set();
    clients.set(ws, topics);
    if (hello) send(ws, hello);
    if (gameState) send(ws, gameState);

    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      if (message?.type === "ping") {
        send(ws, { type: "pong", nonce: message.nonce ?? "" });
      }
      if (message?.type === "subscribe" && typeof message.topic === "string") {
        topics.add(message.topic);
        const ack = acks.get(message.topic);
        if (ack) send(ws, ack);
        const frame = latest.get(message.topic);
        if (frame) send(ws, deliveredAt(frame, nowUt));
      }
      if (message?.type === "unsubscribe") topics.delete(message.topic);
    });
    ws.on("close", () => clients.delete(ws));
  });

  http.listen(port, () => {
    process.stdout.write(`[wire-replay] listening on ws://localhost:${port}\n`);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => http.close(() => process.exit(0)));
  }
  return http;
}

const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) startWireReplayServer();
