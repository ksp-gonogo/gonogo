/**
 * A Sitrep stream one SCREEN observes, at one vantage, on a live clock.
 *
 * `sitrep-stream-server.mjs` cannot do this job and is not extended to,
 * for two reasons that are both about the delay rather than about topics:
 *
 *   - it stamps every frame `vantage: "fixture"`. A radio scene needs the
 *     screens to be at DIFFERENT vantages, because a light-time is a property
 *     of a PAIR and two screens reading the same vantage are co-located: the
 *     same transmission would be due at the same instant on both, which is the
 *     one thing the scene exists to disprove
 *   - it stamps a FIXED `validAt`/`deliveredAt`. The reader's clock is
 *     anchored on that, and every held chunk is released by comparing its
 *     instant against `utNowEstimate()`, so a pinned clock means nothing is
 *     ever due and the far end hears silence forever. The commcast render
 *     harness records the same finding, measured both ways.
 *
 * So one process is one screen's mod: its own port, its own vantage, and a UT
 * that advances with the wall clock. Every instance derives UT from
 * `Date.now()` against a FIXED wall epoch rather than from its own start, so
 * three servers launched a second apart still agree on what time it is; a
 * per-process anchor would put a skew straight into the measurement the scene
 * is making.
 *
 * The scene itself is not baked in. The spec publishes `commandCentre.roster`,
 * `commandCentre.separation` and the rest over `POST /publish`, so the
 * separation a test runs at is a value in the test rather than an environment
 * variable spread across three server launches.
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number.parseInt(process.env.RADIO_STREAM_PORT ?? "18095", 10);
const VANTAGE = process.env.RADIO_STREAM_VANTAGE ?? "ksc";

/**
 * The UT this scene calls zero-ish, and the wall instant it is pinned to.
 *
 * Both constants, so `ut()` is a pure function of the machine clock and every
 * server on this machine returns the same answer to the millisecond.
 */
const UT_EPOCH = 1_000_000;
const WALL_EPOCH_SECONDS = 1_756_000_000;

function ut() {
  return UT_EPOCH + (Date.now() / 1000 - WALL_EPOCH_SECONDS);
}

export function startRadioStreamServer({
  port = PORT,
  vantage = VANTAGE,
} = {}) {
  /** topic -> payload, as last published. Empty until the spec seeds it. */
  const snapshot = new Map();
  /** Every open connection, so a publish reaches the screens already watching. */
  const clients = new Set();
  let seq = 0;

  function frameMeta() {
    seq += 1;
    const now = ut();
    return {
      source: "commcast-radio-server",
      validAt: now,
      seq,
      deliveredAt: now,
      vantage,
      /*
       * OnRails / Fresh, the same pair `sitrep-stream-server.mjs` justifies at
       * length: nothing in a radio scene reads either, and disagreeing with
       * the established fixture for no reason is its own trap.
       */
      quality: 0,
      active: true,
      staleness: 0,
      timelineEpoch: 0,
    };
  }

  function sendTo(client, topic) {
    if (!snapshot.has(topic)) return;
    if (client.ws.readyState !== client.ws.OPEN) return;
    client.ws.send(
      JSON.stringify({
        type: "stream-data",
        topic,
        payload: snapshot.get(topic),
        meta: frameMeta(),
      }),
    );
  }

  const http = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok\n");
      return;
    }
    if (req.url === "/version") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ version: "fake", buildTime: "test" }));
      return;
    }
    if (req.url === "/publish" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400);
          res.end("bad json\n");
          return;
        }
        /*
         * A LIST, so a whole scene lands in one request and therefore in one
         * burst of frames: publishing the roster and the separation
         * separately gives a screen a frame in which it knows who it can talk
         * to and not how far away they are, which the mod never produces.
         */
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        for (const entry of entries) {
          if (typeof entry?.topic !== "string") continue;
          snapshot.set(entry.topic, entry.payload);
          for (const client of clients) {
            if (client.subs.has(entry.topic)) sendTo(client, entry.topic);
          }
        }
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok\n");
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  // No path: `WebSocketTransport` builds `ws://host:port` with no suffix, the
  // same as the real mod.
  const wss = new WebSocketServer({ server: http });

  wss.on("connection", (ws) => {
    const client = { ws, subs: new Set() };
    clients.add(client);
    process.stdout.write(`[radio-stream ${vantage}] connect\n`);

    /*
     * Re-emit on an interval, which is what keeps the reader's clock moving:
     * `utNowEstimate()` is anchored on the newest frame's `deliveredAt`, so a
     * screen that stopped hearing frames would stop advancing and every held
     * chunk would sit at the far end undelivered. 200 ms rather than the
     * established fixture's 250 ms for no reason worth a comment; both are far
     * under any light-time a scene runs at.
     */
    const ticker = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      for (const topic of client.subs) sendTo(client, topic);
    }, 200);

    ws.on("message", (raw) => {
      let data;
      try {
        data = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      if (typeof data !== "object" || data === null) return;
      if (data.type === "subscribe" && typeof data.topic === "string") {
        client.subs.add(data.topic);
        sendTo(client, data.topic);
      } else if (
        data.type === "unsubscribe" &&
        typeof data.topic === "string"
      ) {
        client.subs.delete(data.topic);
      }
    });

    ws.on("close", () => {
      clearInterval(ticker);
      clients.delete(client);
      process.stdout.write(`[radio-stream ${vantage}] disconnect\n`);
    });
  });

  http.listen(port, () => {
    process.stdout.write(
      `[radio-stream ${vantage}] listening on ws://localhost:${port}\n`,
    );
  });

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      http.close(() => process.exit(0));
    });
  }

  return http;
}

const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) startRadioStreamServer();
