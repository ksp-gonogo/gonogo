/**
 * The mod, as a radio scene needs it: one Sitrep stream per SCREEN, each at its
 * own vantage, and Commcast carried between them the way the mod carries it.
 *
 * `sitrep-stream-server.mjs` cannot do this job and is not extended to:
 *
 *   - it stamps every frame `vantage: "fixture"`. A radio scene needs the
 *     screens at DIFFERENT vantages, because a light-time is a property of a
 *     PAIR, so each port here serves one vantage
 *   - it stamps a FIXED `validAt`/`deliveredAt`, and a pinned clock means
 *     nothing is ever due. UT here advances with the wall clock
 *   - Commcast is addressed and delayed by the mod, so the three ports share
 *     one process and one set of groups: what a screen at one port says reaches
 *     a screen at another one light-time later, and a screen that is not
 *     addressed receives nothing
 *
 * UT derives from `Date.now()` against a FIXED wall epoch, so it is a pure
 * function of the machine clock. The scene itself is not baked in: the spec
 * publishes `commandCentre.roster`, `commandCentre.separation` and the rest over
 * `POST /publish` on each port, and the separations it publishes are the
 * delays Commcast is carried at.
 *
 * The addressing is the mod's rule (`Sitrep.Host.Commcast.CommcastUplink`),
 * restated: a speaker addresses itself and every member it can see that it has
 * a route to, and a membership change counts at a vantage once it has crossed
 * there from its author.
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const UT_EPOCH = 1_000_000;
const WALL_EPOCH_SECONDS = 1_756_000_000;

function ut() {
  return UT_EPOCH + (Date.now() / 1000 - WALL_EPOCH_SECONDS);
}

const BINARY_MAGIC = 0x9e;
const LANE_STREAM_BINARY = 0x01;
const TRAFFIC = "commcast.traffic";
const RADIO = "commcast.radio";

/** Every connection on every port, each at its port's vantage. */
const clients = new Set();

/** port -> topic -> payload, as last published there. */
const snapshots = new Map();

/** groupId -> membership changes, in the order they were made. */
const groups = new Map();

/** message id -> { author, to }, so an acknowledgement can be addressed. */
const messages = new Map();

/** transmission id -> { from, groupId, startedUt }. */
const transmissions = new Map();

let seq = 0;

function meta(vantage, validAt, deliveredAt) {
  seq += 1;
  return {
    source: "commcast-radio-server",
    validAt,
    seq,
    deliveredAt,
    vantage,
    quality: 0,
    active: true,
    staleness: 0,
    timelineEpoch: 0,
  };
}

/** The published separation pairs, off whichever port holds them. */
function separations() {
  for (const snapshot of snapshots.values()) {
    const pairs = snapshot.get("commandCentre.separation")?.pairs;
    if (Array.isArray(pairs)) return pairs;
  }
  return [];
}

/** One-way seconds between two vantages, or `null` where no route is published. */
function delay(a, b) {
  if (a === b) return 0;
  for (const pair of separations()) {
    if (
      (pair.from === a && pair.to === b) ||
      (pair.from === b && pair.to === a)
    ) {
      return pair.oneWaySeconds;
    }
  }
  return null;
}

/** The group's members as `vantage` knows them at `at`. */
function knownAt(changes, vantage, at) {
  const members = new Set();
  for (const change of changes) {
    const d = delay(vantage, change.author);
    const heard =
      change.author === vantage ||
      (change.reached.has(vantage) && d !== null && change.ut + d <= at);
    if (!heard) continue;
    for (const id of change.added) members.add(id);
  }
  return [...members];
}

/** The speaker, and every member it knows of that a signal from it can reach. */
function addressed(speaker, members) {
  const to = new Set([speaker]);
  for (const member of members) {
    if (delay(member, speaker) !== null) to.add(member);
  }
  return [...to].sort();
}

function binaryFrame(header, segments) {
  const json = Buffer.from(
    JSON.stringify({ ...header, segments: segments.map((s) => s.length) }),
    "utf8",
  );
  const prefix = Buffer.from([
    BINARY_MAGIC,
    LANE_STREAM_BINARY,
    json.length >> 8,
    json.length & 0xff,
  ]);
  return Buffer.concat([prefix, json, ...segments]);
}

/**
 * Deliver something said by `from` at `validAt` to each addressed vantage, one
 * light-time later. Whoever is subscribed there when it lands hears it, which
 * includes a screen that connected while it was still crossing.
 */
function say(topic, from, validAt, to, build) {
  for (const vantage of to) {
    const d = delay(vantage, from);
    if (d === null) continue;
    const deliveredAt = validAt + d;
    setTimeout(
      () => {
        for (const client of clients) {
          if (client.vantage !== vantage || !client.subs.has(topic)) continue;
          if (client.ws.readyState !== client.ws.OPEN) continue;
          client.ws.send(build(meta(vantage, validAt, deliveredAt)));
        }
      },
      Math.max(0, (deliveredAt - ut()) * 1000),
    );
  }
}

function traffic(from, to, item, at) {
  say(TRAFFIC, from, at, to, (m) =>
    JSON.stringify({
      type: "stream-data",
      topic: TRAFFIC,
      payload: { ...item, from, sentUt: at, to },
      meta: m,
    }),
  );
}

function changeMembers(groupId, from, author, members, added, at) {
  const reached = new Set(addressed(from, members));
  const change = { ut: at, author: from, reached, added };
  const changes = groups.get(groupId) ?? [];
  changes.push(change);
  groups.set(groupId, changes);
  traffic(
    from,
    [...reached].sort(),
    {
      kind: "members",
      id: `${groupId}@${at}`,
      groupId,
      author,
      members: [...members].sort(),
      added: [...added].sort(),
    },
    at,
  );
}

/** A command, answered at once: `null` for success, or the reason it was refused. */
function handle(from, command, args) {
  const at = ut();
  const author = args?.author ?? { name: "", stationKey: "", seat: "" };
  if (command === "commcast.group.open") {
    if (groups.has(args.groupId)) return "a group already holds that id";
    const members = [...new Set([from, ...(args.members ?? [])])];
    changeMembers(args.groupId, from, author, members, members, at);
    return null;
  }
  if (command === "commcast.message.ack") {
    const message = messages.get(args.messageId);
    if (!message?.to.includes(from)) return "not addressed here";
    const to = delay(message.author, from) === null ? [] : [message.author];
    traffic(
      from,
      to,
      { kind: "ack", groupId: "", author, messageId: args.messageId },
      at,
    );
    return null;
  }
  const changes = groups.get(args?.groupId);
  if (!changes) return "no group with that id is known";
  const known = knownAt(changes, from, at);
  if (!known.includes(from)) return "not a member as far as it knows";
  if (command === "commcast.group.add") {
    const added = (args.added ?? []).filter((id) => !known.includes(id));
    if (added.length === 0) return null;
    changeMembers(args.groupId, from, author, [...known, ...added], added, at);
    return null;
  }
  const to = addressed(from, known);
  if (command === "commcast.message.send") {
    messages.set(args.id, { author: from, to });
    traffic(
      from,
      to,
      {
        kind: "text",
        id: args.id,
        groupId: args.groupId,
        author,
        body: args.body,
      },
      at,
    );
    return null;
  }
  if (command === "commcast.radio.transmit") {
    let t = transmissions.get(args.transmissionId);
    if (!t) {
      t = { from, groupId: args.groupId, startedUt: at };
      transmissions.set(args.transmissionId, t);
    }
    const head = Buffer.from(
      JSON.stringify({
        transmissionId: args.transmissionId,
        groupId: args.groupId,
        from,
        author,
        startedUt: t.startedUt,
        seq: args.seq,
        end: args.end === true,
        to,
      }),
      "utf8",
    );
    const chunks = (args.chunks ?? []).map((c) => Buffer.from(c, "base64"));
    say(RADIO, from, at, to, (m) =>
      binaryFrame({ type: "stream-binary", topic: RADIO, meta: m }, [
        head,
        ...chunks,
      ]),
    );
    return null;
  }
  return `unknown command ${command}`;
}

export function startRadioStreamServer({ port, vantage }) {
  const snapshot = new Map();
  snapshots.set(port, snapshot);

  function sendTo(client, topic) {
    if (!snapshot.has(topic)) return;
    if (client.ws.readyState !== client.ws.OPEN) return;
    const now = ut();
    client.ws.send(
      JSON.stringify({
        type: "stream-data",
        topic,
        payload: snapshot.get(topic),
        meta: meta(vantage, now, now),
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
        // A LIST, so a whole scene lands in one burst of frames, as the mod would send it.
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        for (const entry of entries) {
          if (typeof entry?.topic !== "string") continue;
          snapshot.set(entry.topic, entry.payload);
          for (const client of clients) {
            if (client.port === port && client.subs.has(entry.topic)) {
              sendTo(client, entry.topic);
            }
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

  // No path: `WebSocketTransport` builds `ws://host:port` with no suffix, the same as the real mod.
  const wss = new WebSocketServer({ server: http });

  wss.on("connection", (ws) => {
    const client = { ws, subs: new Set(), vantage, port };
    clients.add(client);
    process.stdout.write(`[radio-stream ${vantage}] connect\n`);

    // Re-emit on an interval: `utNowEstimate()` is anchored on the newest frame, so a quiet screen's clock would stop.
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
        return;
      }
      if (data.type === "unsubscribe" && typeof data.topic === "string") {
        client.subs.delete(data.topic);
        return;
      }
      if (data.type === "command-request" && typeof data.command === "string") {
        const refusal = handle(vantage, data.command, data.args);
        const now = ut();
        ws.send(
          JSON.stringify({
            type: "command-response",
            requestId: data.requestId,
            result:
              refusal === null
                ? { success: true }
                : { success: false, errorCode: "wrongState", reason: refusal },
            meta: meta(vantage, now, now),
          }),
        );
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

  return http;
}

/**
 * `RADIO_STREAM_SERVERS` names every port and its vantage, `port=vantage`
 * comma-separated, all served from this one process so they share Commcast.
 */
function serversFromEnv() {
  const spec = process.env.RADIO_STREAM_SERVERS ?? "18095=ksc";
  return spec.split(",").map((entry) => {
    const at = entry.indexOf("=");
    return {
      port: Number.parseInt(entry.slice(0, at), 10),
      vantage: entry.slice(at + 1),
    };
  });
}

const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const servers = serversFromEnv().map(startRadioStreamServer);
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      for (const http of servers) http.close();
      process.exit(0);
    });
  }
}
