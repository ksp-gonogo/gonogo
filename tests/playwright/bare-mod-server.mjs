/**
 * A game with nothing loaded: a fake mod that answers only for the host record.
 * The app under test points here when a spec seeds no stream of its own, so a
 * local screen finds a game to host on and draws its dashboard with no flight.
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { createHostRecord } from "./fake-host-record.mjs";

const PORT = Number(process.env.BARE_MOD_PORT ?? 18089);

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const hostRecord = createHostRecord({
  send: (ws, frame) => ws.send(JSON.stringify(frame)),
  meta: () => ({
    source: "bare-mod",
    validAt: 0,
    seq: 0,
    deliveredAt: 0,
    vantage: "",
    quality: 0,
    active: true,
    staleness: 0,
    timelineEpoch: 0,
  }),
});

const wss = new WebSocketServer({ server: http });
wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    if (data?.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", nonce: data.nonce ?? "" }));
      return;
    }
    hostRecord.handle(ws, data);
  });
  ws.on("close", () => hostRecord.closed(ws));
});

http.listen(PORT, () => {
  process.stdout.write(`[bare-mod] listening on ws://localhost:${PORT}\n`);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => http.close(() => process.exit(0)));
}
